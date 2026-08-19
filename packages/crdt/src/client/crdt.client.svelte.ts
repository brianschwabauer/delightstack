/**
 * `CrdtClient` — the browser half of `@delightstack/crdt`.
 *
 * Owns a set of open Loro documents, their local persistence, and the
 * conversation with the document servers. It does **not** own the connection
 * (see `transport.ts`) and it has no opinion about the document's schema — it
 * moves update blobs and keeps them durable.
 *
 * ## The bootstrap gate — read this before anything else
 *
 * A Loro shallow snapshot can only be imported into a document whose version
 * already covers the snapshot's shallow start. An empty document is the special
 * case that always works. A document with **one single operation** in it that
 * the server has already compacted away is not: `import()` returns
 * `{ success: {}, pending: {} }`, throws nothing, and leaves the document
 * exactly as it was. Nothing in the Loro API signals this.
 *
 * A rich-text editor's *first transaction writes an empty document into the
 * CRDT.* So an editor mounted before the first sync completes puts the client
 * permanently behind a compacted server's shallow start, and that device can
 * never be caught up again — silently, forever. This is not hypothetical; it is
 * exactly how the Milestone 0 spike failed.
 *
 * The gate is {@link CrdtHandle.loading} / {@link CrdtHandle.ready}. It clears
 * on the **first** of:
 *
 * 1. the first `sync` message from the server for this document;
 * 2. local storage already containing operations (the document cannot be
 *    "empty and dirty", so there is nothing left to protect);
 * 3. {@link CrdtClientConfig.bootstrap_timeout_ms} (default 1.5s), which is
 *    what makes a genuinely offline first run usable.
 *
 * And it has teeth: {@link CrdtHandle.transact} **throws** while `loading`.
 * Documenting the ordering rule was not enough for the spike, so the client
 * enforces it.
 *
 * ```ts
 * const handle = await crdt.open(node_id);
 * await handle.ready();          // ← never mount an editor before this
 * mountEditor(handle.doc);
 * ```
 */

import { DelightError, generateTimestampID } from '@delightstack/utilities';
import { LoroDoc, VersionVector, type LoroEventBatch } from '../loro.client.js';
import type { Actor, Frontier } from '../types.js';
import { EMPTY_FRONTIER, encodeFrontier } from './frontier.js';
import {
	IdbCrdtStorage,
	MemoryCrdtStorage,
	type CrdtDocStore,
	type CrdtStorage,
} from './storage.js';
import { OpfsCrdtStorage } from './opfs.storage.js';
import type { CrdtInboundMessage, CrdtTransport } from './transport.js';

/** How long to wait for a first `sync` before letting a cold document be edited. */
export const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 1_500;

/**
 * How long a local commit waits before it goes on the wire.
 *
 * The spike measured one blob, one frame and one `op_id` per keystroke: ~90
 * bytes of CRDT inside a ~175 byte frame, so nearly half the traffic was
 * framing. Commits inside this window are coalesced into a single update, which
 * removes that tax at the cost of this much extra exposure on a crash — and the
 * OPFS append is *not* debounced, so "exposure" means "the server hears about
 * it later", never "the edit is lost".
 */
export const DEFAULT_SEND_DEBOUNCE_MS = 200;

/** How long a document stays resident after its last reader closes it. */
export const DEFAULT_IDLE_EVICT_MS = 5 * 60 * 1000;

/** Soft cap on total local body storage before LRU eviction starts. */
export const DEFAULT_QUOTA_BYTES = 2_000_000_000;

/** Updates appended to the pending log before it is folded into a snapshot. */
export const DEFAULT_SNAPSHOT_EVERY = 50;

/** The unified sync indicator described in `03-sync-and-offline.md`. */
export type CrdtSyncState = 'synced' | 'syncing' | 'offline' | 'error';

/** What the caller must be told when a device is too far behind to merge. */
export interface CrdtResetInfo {
	node_id: string;
	/** Local commits that can never reach the server. Data loss, if it is > 0. */
	unacked_ops: number;
}

export interface CrdtClientConfig {
	/** Moves bytes. This package never opens a socket — see `transport.ts`. */
	transport: CrdtTransport;
	/**
	 * `'opfs'` (default) is the only durable backend. `'idb'` throws
	 * `not_implemented` — IndexedDB cannot offer the synchronous append
	 * `transact()` guarantees, so supporting it would weaken the contract rather
	 * than widen support. A `CrdtStorage` instance may be passed instead.
	 */
	storage?: 'opfs' | 'idb' | CrdtStorage;
	/** Soft cap on local body bytes. Default 2GB. */
	quota_bytes?: number;
	/** Default `actor` recorded on updates. Per-call `transact` opts override it. */
	actor?: Actor;
	bootstrap_timeout_ms?: number;
	send_debounce_ms?: number;
	idle_evict_ms?: number;
	snapshot_every?: number;
	/**
	 * The server told this device it is behind the retained history.
	 *
	 * Nothing can merge in either direction: local commits can never be
	 * accepted, and the server's snapshot can never be imported on top of them.
	 * The client refuses to apply the reset by itself — it marks the handle
	 * unusable and calls this, because discarding a user's offline work is a
	 * decision a UI must make, not a library. Recover with
	 * `await crdt.purge(node_id)` then `await crdt.open(node_id)`.
	 */
	on_reset?: (info: CrdtResetInfo) => void;
	/** Override `op_id` generation. Defaults to a 20-char timestamp id. */
	generateOpId?: () => string;
}

/** One open document. */
export interface CrdtHandle {
	readonly node_id: string;
	/** The live Loro document. Read freely; write only through {@link transact}. */
	readonly doc: LoroDoc;
	/** The document's current point in history. */
	readonly frontier: Frontier;
	/** Reactive. True until the bootstrap gate clears — see the module comment. */
	readonly loading: boolean;
	/** Reactive. Local commits this device has not had acked. */
	readonly pending_count: number;
	/** Resolves when {@link loading} goes false. Await before mounting an editor. */
	ready(): Promise<void>;
	/**
	 * Apply a local change.
	 *
	 * Synchronous, and the resulting update blob is appended to the local log
	 * before this returns (given a worker-hosted OPFS — see `opfs.storage.ts`).
	 * Persistence and the network send are fire-and-forget from here.
	 *
	 * @throws `bootstrap_pending` while {@link loading} is true.
	 */
	transact(fn: (doc: LoroDoc) => void, opts?: { actor?: Actor }): void;
	/** Subscribe to Loro events. Returns an unsubscribe function. */
	subscribe(fn: (event: LoroEventBatch) => void): () => void;
}

/** One local commit waiting to be acknowledged. */
interface OutboxEntry {
	op_id: string;
	actor: Actor;
	/** Version vector the blob was exported from — the coalescing anchor. */
	from_version: Uint8Array;
	blob: Uint8Array;
	/** `op_id`s of the log records this entry covers; all are acked together. */
	record_op_ids: string[];
	sent: boolean;
}

/* ========================================================================== */

class Handle implements CrdtHandle {
	readonly node_id: string;
	readonly doc: LoroDoc = new LoroDoc();

	#client: CrdtClient;
	#store: CrdtDocStore;
	#loading = $state(true);
	#pending_count = $state(0);
	#frontier = $state<Frontier>(EMPTY_FRONTIER);
	#reset_required = false;
	/**
	 * True once the server has answered this connection's `subscribe`.
	 *
	 * Nothing is sent before that. The server's answer is where `reset` lives —
	 * the "your ops can never be accepted, their dependencies are trimmed"
	 * verdict — and pushing an update ahead of it means pushing a blob the
	 * server can only reject.
	 */
	#handshaked = false;
	#outbox: OutboxEntry[] = [];
	#records_since_snapshot = 0;
	#send_timer: ReturnType<typeof setTimeout> | null = null;
	#bootstrap_timer: ReturnType<typeof setTimeout> | null = null;
	#ready_promise: Promise<void>;
	#ready_resolve!: () => void;
	#closed = false;

	constructor(client: CrdtClient, node_id: string, store: CrdtDocStore) {
		this.#client = client;
		this.node_id = node_id;
		this.#store = store;
		this.#ready_promise = new Promise((resolve) => {
			this.#ready_resolve = resolve;
		});
	}

	get loading(): boolean {
		return this.#loading;
	}

	get pending_count(): number {
		return this.#pending_count;
	}

	get frontier(): Frontier {
		return this.#frontier;
	}

	get store(): CrdtDocStore {
		return this.#store;
	}

	get outbox_size(): number {
		return this.#outbox.length;
	}

	ready(): Promise<void> {
		return this.#ready_promise;
	}

	/**
	 * Rebuild from local storage, then arm the bootstrap timeout.
	 *
	 * Deliberately awaited before anything touches the network: the app must be
	 * usable with the connection down, and a document that already has local
	 * operations needs no gate at all.
	 */
	async hydrate(timeout_ms: number): Promise<void> {
		const loaded = await this.#store.load();
		if (loaded.snapshot) this.doc.import(loaded.snapshot);
		for (const record of loaded.pending) {
			this.doc.import(record.blob);
			if (record.local && record.op_id) {
				// Rebuilt from disk, so `from_version` is unknown — it is only used
				// to coalesce never-sent commits, and a replayed one is treated as
				// already sent so its `op_id` (and the server's dedupe) survives.
				this.#outbox.push({
					op_id: record.op_id,
					actor: record.actor ?? this.#client.actor,
					from_version: new Uint8Array(0),
					blob: record.blob,
					record_op_ids: [record.op_id],
					sent: true,
				});
			}
		}
		this.#records_since_snapshot = loaded.pending.length;
		this.#syncCounters();

		if (this.doc.oplogVersion().length() > 0) {
			// Not empty, so the "empty doc dirtied before first sync" trap cannot
			// apply any more — there is nothing left for the gate to protect.
			this.#openGate();
		} else {
			this.#bootstrap_timer = setTimeout(() => this.#openGate(), timeout_ms);
		}
	}

	transact(fn: (doc: LoroDoc) => void, opts?: { actor?: Actor }): void {
		if (this.#closed) {
			throw new DelightError({
				message: 'This document is no longer open.',
				status: 409,
				code: 'doc_closed',
			});
		}
		if (this.#reset_required) {
			throw new DelightError({
				message: 'This device is too far behind to sync this document.',
				status: 409,
				code: 'reset_required',
				detail: `Purge and reopen ${this.node_id}; local changes cannot be merged.`,
			});
		}
		if (this.#loading) {
			throw new DelightError({
				message: 'This document is still opening.',
				status: 409,
				code: 'bootstrap_pending',
				detail:
					'Await handle.ready() before writing. Writing into an empty document before ' +
					'its first sync makes it permanently unbootstrappable from a compacted server.',
			});
		}

		const before = this.doc.oplogVersion();
		fn(this.doc);
		this.doc.commit();
		const blob = this.doc.export({ mode: 'update', from: before });
		this.#frontier = encodeFrontier(this.doc.frontiers());
		if (blob.length === 0) return;

		const op_id = this.#client.nextOpId();
		const actor = opts?.actor ?? this.#client.actor;
		this.#store.appendUpdate({ op_id, actor, local: true, blob });
		this.#records_since_snapshot += 1;
		this.#outbox.push({
			op_id,
			actor,
			from_version: before.encode(),
			blob,
			record_op_ids: [op_id],
			sent: false,
		});
		this.#syncCounters();
		this.#scheduleSend();
		this.#maybeFoldSnapshot();
	}

	subscribe(fn: (event: LoroEventBatch) => void): () => void {
		return this.doc.subscribe(fn);
	}

	/* ---------------------------------------------------------------------- */
	/* Wire handling — driven by CrdtClient                                    */
	/* ---------------------------------------------------------------------- */

	/** Ask the server for whatever this document is missing. */
	requestSync(): void {
		if (this.#reset_required) return;
		const version = this.doc.oplogVersion();
		this.#client.transport.send({
			type: 'subscribe',
			node_id: this.node_id,
			// `.length()`, not `encode().length`: an empty version vector still
			// encodes to one byte, so the obvious byte test never fires and a cold
			// client silently asks for an incremental update it cannot apply.
			peer_version: version.length() > 0 ? version.encode() : null,
		});
	}

	/** The connection dropped: nothing may be sent until the next handshake. */
	markDisconnected(): void {
		this.#handshaked = false;
	}

	applySync(message: Extract<CrdtInboundMessage, { type: 'sync' }>): void {
		if (message.kind === 'reset') {
			this.#reset_required = true;
			this.#client.reportReset({
				node_id: this.node_id,
				unacked_ops: this.#outbox.length,
			});
			this.#openGate();
			return;
		}
		if (message.payload.length > 0) this.applyRemote(message.payload);
		this.#handshaked = true;
		this.#openGate();
		// Anything the server has not acked goes back out now. Ops that were
		// already sent keep their `op_id` so the server's dedupe still applies.
		this.resend();
	}

	applyRemote(blob: Uint8Array): void {
		this.doc.import(blob);
		this.#frontier = encodeFrontier(this.doc.frontiers());
		// Remote blobs are persisted too: the local snapshot is only rewritten
		// periodically, and everything since it has to survive a reload.
		this.#store.appendUpdate({ op_id: null, actor: null, local: false, blob });
		this.#records_since_snapshot += 1;
		this.#maybeFoldSnapshot();
	}

	applyAck(op_id: string): void {
		const index = this.#outbox.findIndex((entry) => entry.op_id === op_id);
		if (index === -1) return;
		const [entry] = this.#outbox.splice(index, 1);
		for (const record_op_id of entry.record_op_ids) this.#store.appendAck(record_op_id);
		this.#syncCounters();
	}

	/** Resend everything unacked, in order. Called on every reconnect. */
	resend(): void {
		if (!this.#client.transport.connected || !this.#handshaked) return;
		for (const entry of this.#outbox) {
			if (!entry.sent) continue;
			this.#client.transport.send({
				type: 'update',
				node_id: this.node_id,
				op_id: entry.op_id,
				actor: entry.actor,
				blob: entry.blob,
			});
		}
		this.flushSend();
	}

	/**
	 * Send every commit that has never been on the wire, coalescing a run of
	 * them into one update.
	 *
	 * Coalescing re-exports from the first unsent commit's version vector rather
	 * than concatenating blobs, which is the only way Loro will produce a single
	 * valid update. Entries that have already been sent are never re-coalesced —
	 * that would change their `op_id` and defeat the server's deduplication.
	 */
	flushSend(): void {
		if (this.#send_timer) {
			clearTimeout(this.#send_timer);
			this.#send_timer = null;
		}
		if (!this.#client.transport.connected || this.#reset_required || !this.#handshaked) return;
		const first_unsent = this.#outbox.findIndex((entry) => !entry.sent);
		if (first_unsent === -1) return;
		const unsent = this.#outbox.slice(first_unsent);

		let batch: OutboxEntry[] = unsent;
		if (unsent.length > 1) {
			const anchor = unsent[0].from_version;
			let merged: Uint8Array | null = null;
			try {
				merged = this.doc.export({ mode: 'update', from: VersionVector.decode(anchor) });
			} catch {
				merged = null;
			}
			if (merged && merged.length > 0) {
				batch = [
					{
						op_id: this.#client.nextOpId(),
						actor: unsent[0].actor,
						from_version: anchor,
						blob: merged,
						record_op_ids: unsent.flatMap((entry) => entry.record_op_ids),
						sent: false,
					},
				];
				this.#outbox.splice(first_unsent, unsent.length, ...batch);
			}
		}

		for (const entry of batch) {
			entry.sent = true;
			this.#client.transport.send({
				type: 'update',
				node_id: this.node_id,
				op_id: entry.op_id,
				actor: entry.actor,
				blob: entry.blob,
			});
		}
		this.#syncCounters();
	}

	/* ---------------------------------------------------------------------- */
	/* Persistence                                                             */
	/* ---------------------------------------------------------------------- */

	/**
	 * Fold the pending log into one snapshot.
	 *
	 * Unacked local blobs are **re-appended after** the snapshot even though the
	 * snapshot already contains their operations. They are duplicated on purpose:
	 * the snapshot preserves the *content*, but only a local log record preserves
	 * the `op_id`, and without it a reload would lose the ability to resend and
	 * the server would never hear about the edit. Loro's import is idempotent, so
	 * the duplication costs bytes and nothing else.
	 */
	persistSnapshot(): void {
		this.#store.writeSnapshot(this.doc.export({ mode: 'snapshot' }));
		this.#records_since_snapshot = 0;
		for (const entry of this.#outbox) {
			this.#store.appendUpdate({
				op_id: entry.op_id,
				actor: entry.actor,
				local: true,
				blob: entry.blob,
			});
			this.#records_since_snapshot += 1;
		}
	}

	async close(): Promise<void> {
		this.#closed = true;
		if (this.#send_timer) clearTimeout(this.#send_timer);
		if (this.#bootstrap_timer) clearTimeout(this.#bootstrap_timer);
		this.persistSnapshot();
		await this.#store.flush();
		await this.#store.close();
	}

	get has_unacked(): boolean {
		return this.#outbox.length > 0;
	}

	#maybeFoldSnapshot(): void {
		if (this.#records_since_snapshot < this.#client.snapshot_every) return;
		this.persistSnapshot();
	}

	#scheduleSend(): void {
		if (this.#send_timer) return;
		this.#send_timer = setTimeout(() => {
			this.#send_timer = null;
			this.flushSend();
		}, this.#client.send_debounce_ms);
	}

	#openGate(): void {
		if (this.#bootstrap_timer) {
			clearTimeout(this.#bootstrap_timer);
			this.#bootstrap_timer = null;
		}
		if (!this.#loading) return;
		this.#loading = false;
		this.#frontier = encodeFrontier(this.doc.frontiers());
		this.#ready_resolve();
	}

	#syncCounters(): void {
		this.#pending_count = this.#outbox.length;
		this.#client.recount();
	}
}

/* ========================================================================== */

interface Resident {
	handle: Handle;
	refs: number;
	evict_timer: ReturnType<typeof setTimeout> | null;
}

export class CrdtClient {
	readonly transport: CrdtTransport;
	readonly storage: CrdtStorage;
	readonly actor: Actor;
	readonly quota_bytes: number;
	readonly send_debounce_ms: number;
	readonly snapshot_every: number;

	#bootstrap_timeout_ms: number;
	#idle_evict_ms: number;
	#on_reset: ((info: CrdtResetInfo) => void) | undefined;
	#generateOpId: () => string;

	#residents = new Map<string, Resident>();
	#opening = new Map<string, Promise<CrdtHandle>>();
	#unsubscribers: Array<() => void> = [];

	#connected = $state(false);
	#pending_count = $state(0);
	#has_error = $state(false);
	#sync_state = $derived<CrdtSyncState>(
		this.#has_error
			? 'error'
			: !this.#connected
				? 'offline'
				: this.#pending_count > 0
					? 'syncing'
					: 'synced',
	);

	constructor(config: CrdtClientConfig) {
		this.transport = config.transport;
		this.storage = resolveStorage(config.storage);
		this.actor = config.actor ?? 'user:local';
		this.quota_bytes = config.quota_bytes ?? DEFAULT_QUOTA_BYTES;
		this.send_debounce_ms = config.send_debounce_ms ?? DEFAULT_SEND_DEBOUNCE_MS;
		this.snapshot_every = config.snapshot_every ?? DEFAULT_SNAPSHOT_EVERY;
		this.#bootstrap_timeout_ms =
			config.bootstrap_timeout_ms ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS;
		this.#idle_evict_ms = config.idle_evict_ms ?? DEFAULT_IDLE_EVICT_MS;
		this.#on_reset = config.on_reset;
		this.#generateOpId = config.generateOpId ?? (() => generateTimestampID());
		this.#connected = this.transport.connected;

		this.#unsubscribers.push(
			this.transport.onMessage((message) => this.#receive(message)),
			this.transport.onConnectionChange((connected) => {
				this.#connected = connected;
				if (!connected) {
					for (const resident of this.#residents.values()) resident.handle.markDisconnected();
					return;
				}
				// Re-subscribing is the whole of the catch-up protocol: the server
				// answers with a version-vector diff, so an offline session of any
				// length needs no replay of its own.
				for (const resident of this.#residents.values()) resident.handle.requestSync();
			}),
		);
	}

	/** Reactive. The unified indicator from `03-sync-and-offline.md`. */
	get sync_state(): CrdtSyncState {
		return this.#sync_state;
	}

	/** Reactive. Local commits across all open documents that are unacked. */
	get pending_count(): number {
		return this.#pending_count;
	}

	/**
	 * Open a document.
	 *
	 * Resolves once local storage has been replayed — no network on that path,
	 * so it is fast and works offline. The returned handle is still `loading`:
	 * **await `handle.ready()` before mounting an editor.** See the module
	 * comment for why that ordering is not a nicety.
	 */
	open(node_id: string): Promise<CrdtHandle> {
		const resident = this.#residents.get(node_id);
		if (resident) {
			resident.refs += 1;
			if (resident.evict_timer) {
				clearTimeout(resident.evict_timer);
				resident.evict_timer = null;
			}
			return Promise.resolve(resident.handle);
		}
		const in_flight = this.#opening.get(node_id);
		if (in_flight) return in_flight;

		const promise = this.#openFresh(node_id).finally(() => this.#opening.delete(node_id));
		this.#opening.set(node_id, promise);
		return promise;
	}

	/**
	 * Stop reading a document.
	 *
	 * The document stays resident for `idle_evict_ms` after the last reader —
	 * reopening a manuscript you just closed should not re-read OPFS — and is
	 * then snapshotted and dropped.
	 */
	close(node_id: string): void {
		const resident = this.#residents.get(node_id);
		if (!resident) return;
		resident.refs = Math.max(0, resident.refs - 1);
		if (resident.refs > 0 || resident.evict_timer) return;
		resident.evict_timer = setTimeout(() => {
			void this.evict(node_id);
		}, this.#idle_evict_ms);
	}

	/**
	 * Write the document's snapshot and drop the Loro instance from memory.
	 *
	 * Memory only — the local copy stays on disk and a later {@link open}
	 * restores from it. A document with unacked local commits is **not** evicted:
	 * dropping it would leave nothing in memory to resend from until something
	 * reopened it.
	 */
	async evict(node_id: string): Promise<void> {
		const resident = this.#residents.get(node_id);
		if (!resident) return;
		if (resident.handle.has_unacked && this.transport.connected) {
			// Try again after another idle window rather than stranding the ops.
			resident.evict_timer = setTimeout(() => {
				void this.evict(node_id);
			}, this.#idle_evict_ms);
			return;
		}
		if (resident.evict_timer) clearTimeout(resident.evict_timer);
		this.#residents.delete(node_id);
		this.transport.send({ type: 'unsubscribe', node_id });
		await resident.handle.close();
		this.recount();
		await this.enforceQuota();
	}

	/**
	 * Delete a document's local copy entirely.
	 *
	 * The recovery path from a `reset`: the device's local state can never merge
	 * with the server's, so it is discarded and the next {@link open} bootstraps
	 * from scratch. **Destructive** — unacked local commits are lost, which is
	 * why the client never does this on its own.
	 */
	async purge(node_id: string): Promise<void> {
		const resident = this.#residents.get(node_id);
		if (resident) {
			if (resident.evict_timer) clearTimeout(resident.evict_timer);
			this.#residents.delete(node_id);
			await resident.handle.store.close();
		}
		await this.storage.remove(node_id);
		this.recount();
	}

	/** Every currently resident document. */
	listOpen(): string[] {
		return [...this.#residents.keys()];
	}

	/** Flush every issued write. Call before the worker is torn down. */
	async flush(): Promise<void> {
		for (const resident of this.#residents.values()) {
			resident.handle.flushSend();
			await resident.handle.store.flush();
		}
	}

	/** Snapshot and drop everything, then stop listening to the transport. */
	async destroy(): Promise<void> {
		for (const unsubscribe of this.#unsubscribers) unsubscribe();
		this.#unsubscribers = [];
		for (const node_id of [...this.#residents.keys()]) {
			const resident = this.#residents.get(node_id);
			if (!resident) continue;
			if (resident.evict_timer) clearTimeout(resident.evict_timer);
			this.#residents.delete(node_id);
			await resident.handle.close();
		}
		this.recount();
	}

	/**
	 * Bring local storage back under the soft quota by dropping LRU documents.
	 *
	 * Two things are never dropped: a document that is currently resident, and a
	 * document holding unacked local commits. The second is the important one —
	 * quota pressure must never be a route to losing an edit that the server has
	 * not seen, so a workspace whose entire quota is unacked work simply stays
	 * over quota.
	 */
	async enforceQuota(): Promise<number> {
		const stored = await this.storage.list();
		let total = 0;
		for (const meta of stored) total += meta.byte_size;
		if (total <= this.quota_bytes) return total;

		const evictable = stored
			.filter((meta) => !meta.has_unacked && !this.#residents.has(meta.node_id))
			.sort((a, b) => a.last_access - b.last_access);
		for (const meta of evictable) {
			if (total <= this.quota_bytes) break;
			await this.storage.remove(meta.node_id);
			total -= meta.byte_size;
		}
		return total;
	}

	/* -------------------------------------------------------------------- */
	/* Internals used by Handle                                             */
	/* -------------------------------------------------------------------- */

	nextOpId(): string {
		return this.#generateOpId();
	}

	recount(): void {
		let total = 0;
		for (const resident of this.#residents.values())
			total += resident.handle.pending_count;
		this.#pending_count = total;
	}

	reportReset(info: CrdtResetInfo): void {
		this.#has_error = true;
		this.#on_reset?.(info);
	}

	async #openFresh(node_id: string): Promise<CrdtHandle> {
		const store = await this.storage.open(node_id);
		const handle = new Handle(this, node_id, store);
		this.#residents.set(node_id, { handle, refs: 1, evict_timer: null });
		await handle.hydrate(this.#bootstrap_timeout_ms);
		this.recount();
		handle.requestSync();
		void this.enforceQuota();
		return handle;
	}

	#receive(message: CrdtInboundMessage): void {
		if (message.type === 'error') {
			this.#has_error = true;
			return;
		}
		const resident = this.#residents.get(message.node_id);
		if (!resident) return;
		if (message.type === 'sync') resident.handle.applySync(message);
		else if (message.type === 'broadcast') resident.handle.applyRemote(message.blob);
		else if (message.type === 'ack') resident.handle.applyAck(message.op_id);
	}
}

function resolveStorage(storage: CrdtClientConfig['storage']): CrdtStorage {
	if (!storage || storage === 'opfs') {
		const opfs = new OpfsCrdtStorage();
		// A non-browser host (SSR, tests, a Node CLI) gets a working, non-durable
		// backend rather than a throw at construction — the failure mode should be
		// "nothing was saved", not "the app did not start".
		return opfs.available ? opfs : new MemoryCrdtStorage();
	}
	if (storage === 'idb') return new IdbCrdtStorage();
	return storage;
}
