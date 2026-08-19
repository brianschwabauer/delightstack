/**
 * The OPFS backend — the real one.
 *
 * Layout, under `<root>/<node_id>/`:
 *
 * ```
 * snapshot.loro   the whole document, rewritten when the log is folded
 * pending.log     framed update + ack records appended since that snapshot
 * meta.json       { last_access, byte_size, has_unacked } for the quota sweeper
 * ```
 *
 * ## Why this must run in a worker
 *
 * `transact()` promises that the update blob reaches the filesystem before
 * control returns to the event loop, so a hard crash cannot lose an edit. The
 * only OPFS API that can honour that is `createSyncAccessHandle()`, whose
 * `write()` is genuinely synchronous — and it exists **only in a worker**. The
 * architecture already puts this layer in a SharedWorker; this class is where
 * that stops being a preference and becomes a correctness requirement.
 *
 * On the main thread the class still works, via `createWritable()`, but the
 * write is only *queued* synchronously and lands a microtask later. That is a
 * real weakening of the guarantee, so it is reported on the instance as
 * {@link OpfsCrdtStorage.durable} — check it and warn rather than assuming.
 */

import { DelightError } from '@delightstack/utilities';
import {
	decodePendingLog,
	encodeAckRecord,
	encodeUpdateRecord,
	type CrdtDocStore,
	type CrdtStorage,
	type LoadedDoc,
	type PendingRecord,
	type StoredDocMeta,
} from './storage.js';

/** The subset of `FileSystemSyncAccessHandle` this backend uses. */
interface SyncAccessHandle {
	read(buffer: Uint8Array, options?: { at?: number }): number;
	write(buffer: Uint8Array, options?: { at?: number }): number;
	truncate(size: number): void;
	getSize(): number;
	flush(): void;
	close(): void;
}

interface SyncCapableFileHandle extends FileSystemFileHandle {
	createSyncAccessHandle?(): Promise<SyncAccessHandle>;
}

const SNAPSHOT_FILE = 'snapshot.loro';
const PENDING_FILE = 'pending.log';
const META_FILE = 'meta.json';

interface DocMetaFile {
	last_access: number;
	byte_size: number;
	has_unacked: boolean;
}

/** Persistence in the Origin Private File System. */
export class OpfsCrdtStorage implements CrdtStorage {
	readonly available: boolean;
	/**
	 * True when appends are genuinely synchronous — i.e. this is running in a
	 * worker with `createSyncAccessHandle()`. False on the main thread, where a
	 * crash in the same tick as an edit can still lose it.
	 */
	readonly durable: boolean;
	#root_name: string;
	#root: FileSystemDirectoryHandle | null = null;

	constructor(root_name = 'crdt') {
		this.#root_name = root_name;
		this.available =
			typeof navigator !== 'undefined' &&
			typeof navigator.storage?.getDirectory === 'function';
		this.durable =
			this.available &&
			typeof FileSystemFileHandle !== 'undefined' &&
			'createSyncAccessHandle' in FileSystemFileHandle.prototype;
	}

	async open(node_id: string): Promise<CrdtDocStore> {
		const root = await this.#rootDir();
		const dir = await root.getDirectoryHandle(node_id, { create: true });
		const store = new OpfsDocStore(node_id, dir);
		await store.init();
		return store;
	}

	async list(): Promise<StoredDocMeta[]> {
		const root = await this.#rootDir();
		const out: StoredDocMeta[] = [];
		for await (const name of directoryNames(root)) {
			let dir: FileSystemDirectoryHandle;
			try {
				dir = await root.getDirectoryHandle(name);
			} catch {
				continue;
			}
			const meta = await readMeta(dir);
			out.push({
				node_id: name,
				byte_size: meta?.byte_size ?? (await measure(dir)),
				last_access: meta?.last_access ?? 0,
				has_unacked: meta?.has_unacked ?? false,
			});
		}
		return out;
	}

	async remove(node_id: string): Promise<void> {
		const root = await this.#rootDir();
		await root.removeEntry(node_id, { recursive: true }).catch(() => {});
	}

	async usage(): Promise<number> {
		let total = 0;
		for (const meta of await this.list()) total += meta.byte_size;
		return total;
	}

	async #rootDir(): Promise<FileSystemDirectoryHandle> {
		if (this.#root) return this.#root;
		if (!this.available) {
			throw new DelightError({
				message: 'This browser cannot store documents for offline use.',
				status: 501,
				code: 'opfs_unavailable',
				detail: 'navigator.storage.getDirectory() is not available in this environment.',
			});
		}
		const origin_root = await navigator.storage.getDirectory();
		this.#root = await origin_root.getDirectoryHandle(this.#root_name, { create: true });
		return this.#root;
	}
}

class OpfsDocStore implements CrdtDocStore {
	#dir: FileSystemDirectoryHandle;
	#sync: SyncAccessHandle | null = null;
	#log_size = 0;
	#snapshot_size = 0;
	#next_seq = 0;
	#has_unacked = false;
	/** Serializes the async fallback path so appends land in issue order. */
	#queue: Promise<void> = Promise.resolve();

	constructor(
		readonly node_id: string,
		dir: FileSystemDirectoryHandle,
	) {
		this.#dir = dir;
	}

	async init(): Promise<void> {
		const handle = (await this.#dir.getFileHandle(PENDING_FILE, {
			create: true,
		})) as SyncCapableFileHandle;
		if (typeof handle.createSyncAccessHandle === 'function') {
			try {
				this.#sync = await handle.createSyncAccessHandle();
				this.#log_size = this.#sync.getSize();
			} catch {
				// Another worker holds the exclusive handle, or we are on the main
				// thread of a browser that exposes the method but refuses it there.
				this.#sync = null;
			}
		}
		if (!this.#sync)
			this.#log_size = (await readFile(this.#dir, PENDING_FILE))?.length ?? 0;
	}

	async load(): Promise<LoadedDoc> {
		const snapshot = await readFile(this.#dir, SNAPSHOT_FILE);
		this.#snapshot_size = snapshot?.length ?? 0;
		const log = this.#sync
			? this.#readSyncLog()
			: ((await readFile(this.#dir, PENDING_FILE)) ?? new Uint8Array(0));
		const pending = decodePendingLog(log);
		this.#next_seq = pending.length;
		this.#has_unacked = pending.some((record) => record.local);
		await this.#writeMeta();
		return { snapshot, pending, next_seq: this.#next_seq };
	}

	appendUpdate(record: Omit<PendingRecord, 'seq'>): PendingRecord {
		this.#next_seq += 1;
		if (record.local) this.#has_unacked = true;
		this.#append(encodeUpdateRecord(record));
		return { ...record, seq: this.#next_seq };
	}

	appendAck(op_id: string): void {
		this.#append(encodeAckRecord(op_id));
	}

	writeSnapshot(snapshot: Uint8Array): void {
		this.#snapshot_size = snapshot.length;
		this.#next_seq = 0;
		this.#has_unacked = false;
		if (this.#sync) {
			this.#sync.truncate(0);
			this.#sync.flush();
			this.#log_size = 0;
		} else {
			this.#log_size = 0;
		}
		this.#enqueue(async () => {
			await writeFile(this.#dir, SNAPSHOT_FILE, snapshot);
			if (!this.#sync) await writeFile(this.#dir, PENDING_FILE, new Uint8Array(0));
			await this.#writeMeta();
		});
	}

	flush(): Promise<void> {
		this.#sync?.flush();
		return this.#queue;
	}

	byteSize(): number {
		return this.#snapshot_size + this.#log_size;
	}

	async close(): Promise<void> {
		await this.flush();
		await this.#writeMeta();
		this.#sync?.close();
		this.#sync = null;
	}

	/**
	 * The synchronous-by-contract half. With a sync access handle the bytes are
	 * in the file before this returns; without one all we can do is issue the
	 * write and keep the ordering.
	 */
	#append(bytes: Uint8Array): void {
		if (this.#sync) {
			this.#sync.write(bytes, { at: this.#log_size });
			this.#log_size += bytes.length;
			return;
		}
		const at = this.#log_size;
		this.#log_size += bytes.length;
		this.#enqueue(async () => {
			const handle = await this.#dir.getFileHandle(PENDING_FILE, { create: true });
			const writable = await handle.createWritable({ keepExistingData: true });
			await writable.write({ type: 'write', position: at, data: bytes as BufferSource });
			await writable.close();
		});
	}

	#readSyncLog(): Uint8Array {
		const handle = this.#sync;
		if (!handle) return new Uint8Array(0);
		const size = handle.getSize();
		const bytes = new Uint8Array(size);
		if (size > 0) handle.read(bytes, { at: 0 });
		this.#log_size = size;
		return bytes;
	}

	#enqueue(work: () => Promise<void>): void {
		this.#queue = this.#queue.then(work).catch(() => {});
	}

	async #writeMeta(): Promise<void> {
		const meta: DocMetaFile = {
			last_access: Date.now(),
			byte_size: this.byteSize(),
			has_unacked: this.#has_unacked,
		};
		await writeFile(
			this.#dir,
			META_FILE,
			new TextEncoder().encode(JSON.stringify(meta)),
		).catch(() => {});
	}
}

/* -------------------------------------------------------------------------- */
/* OPFS helpers                                                               */
/* -------------------------------------------------------------------------- */

async function readFile(
	dir: FileSystemDirectoryHandle,
	name: string,
): Promise<Uint8Array | null> {
	try {
		const handle = await dir.getFileHandle(name);
		const file = await handle.getFile();
		if (file.size === 0) return null;
		return new Uint8Array(await file.arrayBuffer());
	} catch {
		return null;
	}
}

async function writeFile(
	dir: FileSystemDirectoryHandle,
	name: string,
	bytes: Uint8Array,
): Promise<void> {
	const handle = await dir.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	await writable.write(bytes as BufferSource);
	await writable.close();
}

async function readMeta(dir: FileSystemDirectoryHandle): Promise<DocMetaFile | null> {
	const bytes = await readFile(dir, META_FILE);
	if (!bytes) return null;
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as DocMetaFile;
	} catch {
		return null;
	}
}

async function measure(dir: FileSystemDirectoryHandle): Promise<number> {
	const snapshot = await readFile(dir, SNAPSHOT_FILE);
	const log = await readFile(dir, PENDING_FILE);
	return (snapshot?.length ?? 0) + (log?.length ?? 0);
}

/** `keys()` exists on every OPFS implementation but is missing from some TS DOM libs. */
async function* directoryNames(dir: FileSystemDirectoryHandle): AsyncGenerator<string> {
	const iterable = dir as unknown as { keys(): AsyncIterableIterator<string> };
	for await (const name of iterable.keys()) yield name;
}
