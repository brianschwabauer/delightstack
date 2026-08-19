/**
 * Local persistence for document bodies.
 *
 * Two things live on disk per document:
 *
 * - a **snapshot** — the whole document, rewritten when the pending log gets
 *   long or when the document is evicted from memory;
 * - a **pending log** — an append-only stream of every update blob applied
 *   since that snapshot, local *and* remote.
 *
 * The pending log is not an outbox. It exists so a hard crash between a commit
 * and the next snapshot loses nothing; the *network* catch-up on reconnect is a
 * version-vector diff, which covers whatever the server is missing regardless
 * of how the client got there. Local records additionally carry an `op_id` and
 * stay in the log until the server acks them, which is what makes "resend
 * unacked blobs in order on reconnect" possible across a reload.
 *
 * ## Record framing
 *
 * ```
 * u32  record_len   bytes that follow this field
 * u8   kind         1 = update, 2 = ack tombstone
 * u32  header_len
 * ...  header       UTF-8 JSON: { op_id, actor, local }
 * ...  payload      the Loro update blob (empty for a tombstone)
 * ```
 *
 * Acks append a tombstone rather than rewriting the log, so every write is an
 * append and the log is only ever rewritten when it is folded into a snapshot.
 */

import { DelightError } from '@delightstack/utilities';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const RECORD_UPDATE = 1;
const RECORD_ACK = 2;

/** One update blob held in the pending log. */
export interface PendingRecord {
	/** Monotonic within one document. Also the resend order. */
	seq: number;
	/**
	 * The `op_id` the server deduplicates on. Present only for local records —
	 * remote blobs are persisted for crash safety but are never sent back.
	 */
	op_id: string | null;
	actor: string | null;
	/** True for a blob this device produced and the server has not acked. */
	local: boolean;
	blob: Uint8Array;
}

/** Everything needed to rebuild one document with no network. */
export interface LoadedDoc {
	snapshot: Uint8Array | null;
	/** In append order. Import them in this order after the snapshot. */
	pending: PendingRecord[];
	/** Highest `seq` ever used, so appends continue past a reload. */
	next_seq: number;
}

/** Per-document metadata the quota sweeper reads without opening the document. */
export interface StoredDocMeta {
	node_id: string;
	byte_size: number;
	/** Epoch ms of the last open. Used only for LRU ordering, never for merges. */
	last_access: number;
	/** True while at least one local blob is unacked. Never evicted for quota. */
	has_unacked: boolean;
}

/** The per-document half of a {@link CrdtStorage}. */
export interface CrdtDocStore {
	readonly node_id: string;
	/** Snapshot + pending log, ready to import in order. */
	load(): Promise<LoadedDoc>;
	/**
	 * Append one update blob.
	 *
	 * **Synchronous by contract.** The bytes must be handed to the filesystem
	 * before control returns to the event loop — see
	 * {@link OpfsCrdtStorage} for what that costs and when it is not achievable.
	 */
	appendUpdate(record: Omit<PendingRecord, 'seq'>): PendingRecord;
	/** Record that the server acked `op_id`; the blob stops being resendable. */
	appendAck(op_id: string): void;
	/** Replace snapshot + log with one snapshot of the whole document. */
	writeSnapshot(snapshot: Uint8Array): void;
	/** Resolves once every issued write has actually landed. */
	flush(): Promise<void>;
	/** Bytes this document currently occupies. */
	byteSize(): number;
	/** Release handles. The files stay. */
	close(): Promise<void>;
}

/** The storage backend for a whole workspace of documents. */
export interface CrdtStorage {
	/** Whether this backend can run in the current environment. */
	readonly available: boolean;
	open(node_id: string): Promise<CrdtDocStore>;
	/** Everything on disk, for the quota sweeper. Never opens a document. */
	list(): Promise<StoredDocMeta[]>;
	/** Delete a document's local copy entirely. */
	remove(node_id: string): Promise<void>;
	/** Total bytes across all documents. */
	usage(): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Framing                                                                    */
/* -------------------------------------------------------------------------- */

interface RecordHeader {
	op_id?: string;
	actor?: string;
	local?: boolean;
}

/** Encode one log record. Exported for the storage backends and their tests. */
export function encodeRecord(
	kind: typeof RECORD_UPDATE | typeof RECORD_ACK,
	header: RecordHeader,
	payload: Uint8Array,
): Uint8Array {
	const header_bytes = TEXT_ENCODER.encode(JSON.stringify(header));
	const record_len = 1 + 4 + header_bytes.length + payload.length;
	const bytes = new Uint8Array(4 + record_len);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, record_len, false);
	view.setUint8(4, kind);
	view.setUint32(5, header_bytes.length, false);
	bytes.set(header_bytes, 9);
	bytes.set(payload, 9 + header_bytes.length);
	return bytes;
}

export function encodeUpdateRecord(record: Omit<PendingRecord, 'seq'>): Uint8Array {
	return encodeRecord(
		RECORD_UPDATE,
		{
			op_id: record.op_id ?? undefined,
			actor: record.actor ?? undefined,
			local: record.local,
		},
		record.blob,
	);
}

export function encodeAckRecord(op_id: string): Uint8Array {
	return encodeRecord(RECORD_ACK, { op_id }, new Uint8Array(0));
}

/**
 * Decode a whole pending log, applying ack tombstones as it goes.
 *
 * A truncated tail — the signature of a crash mid-append — is **dropped
 * silently**. That is the correct behaviour: a half-written record was never
 * acked, so the document simply lands one edit earlier than the user's last
 * keystroke rather than failing to open at all.
 */
export function decodePendingLog(bytes: Uint8Array, start_seq = 0): LoadedDoc['pending'] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const records: PendingRecord[] = [];
	const acked = new Set<string>();
	let offset = 0;
	let seq = start_seq;

	while (offset + 4 <= bytes.length) {
		const record_len = view.getUint32(offset, false);
		if (record_len < 5 || offset + 4 + record_len > bytes.length) break;
		const kind = view.getUint8(offset + 4);
		const header_len = view.getUint32(offset + 5, false);
		const header_start = offset + 9;
		if (header_start + header_len > bytes.length) break;
		let header: RecordHeader;
		try {
			header = JSON.parse(
				TEXT_DECODER.decode(bytes.subarray(header_start, header_start + header_len)),
			) as RecordHeader;
		} catch {
			break;
		}
		const payload = bytes.slice(header_start + header_len, offset + 4 + record_len);
		offset += 4 + record_len;

		if (kind === RECORD_ACK) {
			if (header.op_id) acked.add(header.op_id);
			continue;
		}
		seq += 1;
		records.push({
			seq,
			op_id: header.op_id ?? null,
			actor: header.actor ?? null,
			local: header.local === true,
			blob: payload,
		});
	}

	// Tombstones are appended after the record they cover, so acks are applied
	// in a second pass rather than by scanning backwards.
	for (const record of records) {
		if (record.local && record.op_id && acked.has(record.op_id)) record.local = false;
	}
	return records;
}

/* -------------------------------------------------------------------------- */
/* Memory backend                                                             */
/* -------------------------------------------------------------------------- */

interface MemoryDocState {
	snapshot: Uint8Array | null;
	log: Uint8Array[];
	last_access: number;
	next_seq: number;
}

/**
 * An in-memory backend behind the real interface.
 *
 * Used by the test suite — OPFS does not exist in Node, and a fake filesystem
 * that pretends it does would test the fake. This stores the **same framed
 * bytes** the OPFS backend writes, so log framing, tombstone handling, crash
 * truncation and snapshot folding are all exercised for real; only the
 * `FileSystemSyncAccessHandle` calls are not. It is exported because a
 * consumer's own tests want it too, and because it is a correct backend for an
 * environment with no persistent storage at all.
 */
export class MemoryCrdtStorage implements CrdtStorage {
	readonly available = true;
	readonly docs = new Map<string, MemoryDocState>();

	async open(node_id: string): Promise<CrdtDocStore> {
		let state = this.docs.get(node_id);
		if (!state) {
			state = { snapshot: null, log: [], last_access: Date.now(), next_seq: 0 };
			this.docs.set(node_id, state);
		}
		state.last_access = Date.now();
		return new MemoryDocStore(node_id, state);
	}

	async list(): Promise<StoredDocMeta[]> {
		const out: StoredDocMeta[] = [];
		for (const [node_id, state] of this.docs) {
			const log = concat(state.log);
			out.push({
				node_id,
				byte_size: (state.snapshot?.length ?? 0) + log.length,
				last_access: state.last_access,
				has_unacked: decodePendingLog(log).some((record) => record.local),
			});
		}
		return out;
	}

	async remove(node_id: string): Promise<void> {
		this.docs.delete(node_id);
	}

	async usage(): Promise<number> {
		let total = 0;
		for (const meta of await this.list()) total += meta.byte_size;
		return total;
	}
}

class MemoryDocStore implements CrdtDocStore {
	constructor(
		readonly node_id: string,
		private state: MemoryDocState,
	) {}

	async load(): Promise<LoadedDoc> {
		const pending = decodePendingLog(concat(this.state.log));
		this.state.next_seq = pending.length;
		return { snapshot: this.state.snapshot, pending, next_seq: pending.length };
	}

	appendUpdate(record: Omit<PendingRecord, 'seq'>): PendingRecord {
		this.state.log.push(encodeUpdateRecord(record));
		this.state.next_seq += 1;
		return { ...record, seq: this.state.next_seq };
	}

	appendAck(op_id: string): void {
		this.state.log.push(encodeAckRecord(op_id));
	}

	writeSnapshot(snapshot: Uint8Array): void {
		this.state.snapshot = snapshot;
		this.state.log = [];
		this.state.next_seq = 0;
	}

	async flush(): Promise<void> {}

	byteSize(): number {
		let total = this.state.snapshot?.length ?? 0;
		for (const chunk of this.state.log) total += chunk.length;
		return total;
	}

	async close(): Promise<void> {
		this.state.last_access = Date.now();
	}
}

function concat(chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const chunk of chunks) total += chunk.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/* -------------------------------------------------------------------------- */
/* IndexedDB — declared, not built                                            */
/* -------------------------------------------------------------------------- */

/**
 * The IndexedDB fallback, deliberately unimplemented.
 *
 * OPFS is available in every browser this package targets (Safari 15.2+,
 * Chrome 86+, Firefox 111+) and, crucially, is the *only* API that can offer
 * the synchronous append `transact()` promises. An IndexedDB backend could not
 * make that guarantee, so it would silently weaken the durability contract
 * rather than widen support. `storage: 'idb'` therefore throws rather than
 * quietly degrading; use {@link MemoryCrdtStorage} if you want a non-durable
 * backend on purpose.
 */
export class IdbCrdtStorage implements CrdtStorage {
	readonly available = false;

	constructor() {
		throw new DelightError({
			message: 'Offline document storage is not available in this browser.',
			status: 501,
			code: 'not_implemented',
			detail:
				'The IndexedDB CRDT backend is not implemented. IndexedDB cannot offer the ' +
				'synchronous append that transact() guarantees, so OPFS is the only supported ' +
				'durable backend. Pass storage: "opfs", or supply your own CrdtStorage.',
		});
	}

	async open(): Promise<CrdtDocStore> {
		throw new DelightError({
			message: 'not implemented',
			status: 501,
			code: 'not_implemented',
		});
	}
	async list(): Promise<StoredDocMeta[]> {
		return [];
	}
	async remove(): Promise<void> {}
	async usage(): Promise<number> {
		return 0;
	}
}
