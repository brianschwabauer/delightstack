/**
 * The durable offline mutation queue.
 *
 * Two IndexedDB stores, both living in the worker's database beside `entities`
 * and `sync_meta`:
 *
 *   - `outbox` : mutations that have not reached the server yet. Keyed by an
 *                auto-incrementing `seq`, which is the drain order.
 *   - `failed` : mutations the server rejected with a 4xx. Keyed by `op_id`.
 *                Nothing retries these; the app decides.
 *
 * The queue owns ordering, retry and persistence. It does NOT own the network:
 * the worker supplies a `send` callback, because the worker is what knows the
 * routes, the headers and the optimistic index. That split is what makes this
 * file testable without a fetch mock.
 */

import { DelightError } from '@delightstack/utilities';

/** The three mutations a queued row can describe. */
export type OutboxOperation = 'create' | 'update' | 'delete';

/** One queued mutation. `seq` is absent until IndexedDB assigns it. */
export interface OutboxRow {
	/** Drain order. Assigned by the store's key generator — never by us. */
	seq?: number;
	/** The client-generated idempotency key the server deduplicates on */
	op_id: string;
	entity_type: string;
	operation: OutboxOperation;
	/** The row's primary key. Minted client-side for an offline create. */
	id: string | number;
	/** The create payload or the update patch; absent for a delete */
	patch?: Record<string, unknown>;
	/**
	 * The client's clock at enqueue time. Display and local sequencing only —
	 * never ordering or conflict resolution, which are `seq` and the server's
	 * clock respectively.
	 */
	created_at: number;
	/** How many send attempts this row has survived */
	attempts: number;
	/** Client-clock time before which the next attempt must not be made */
	next_attempt_at: number;
}

/** Why a mutation stopped being retried. */
export type FailureReason =
	/** The server answered 4xx: validation, permission, conflict */
	| 'rejected'
	/**
	 * An earlier mutation on the SAME row hard-failed. Applying this one would
	 * write against a state that never existed, so it fails with its parent
	 * rather than silently jumping the queue.
	 */
	| 'dependency_failed';

/** One mutation that will not be retried. */
export interface FailedOperation extends OutboxRow {
	seq: number;
	failed_at: number;
	reason: FailureReason;
	error: { message: string; status: number; code?: string };
}

/**
 * The unified connection state, as described in the README.
 *
 * `error` outranks everything: something is in the failed store and only the
 * app (or the user) can clear it.
 */
export type SyncState = 'synced' | 'syncing' | 'offline' | 'error';

/** What the client mirrors reactively. */
export interface OutboxSnapshot {
	pending_count: number;
	failed: FailedOperation[];
	sync_state: SyncState;
}

/** What one send attempt concluded. */
export type SendResult =
	| { ok: true; entity?: Record<string, unknown> }
	/** Offline, a timeout, or a 5xx — the same request will be made again */
	| { ok: false; retry: true }
	/** A 4xx — re-sending cannot change the answer */
	| {
			ok: false;
			retry: false;
			error: { message: string; status: number; code?: string };
	  };

/**
 * Everything time-dependent, in one injectable object.
 *
 * Backoff is the part of this design most likely to regress, and a test that
 * has to sleep 30 real seconds to prove the cap is a test nobody runs. So the
 * clock, the timer and the jitter source are all parameters.
 */
export interface OutboxScheduler {
	now(): number;
	setTimeout(fn: () => void, delay_ms: number): unknown;
	clearTimeout(handle: unknown): void;
	/** Jitter source, `[0, 1)`. */
	random(): number;
}

const DEFAULT_SCHEDULER: OutboxScheduler = {
	now: () => Date.now(),
	setTimeout: (fn, delay_ms) => setTimeout(fn, delay_ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	random: () => Math.random(),
};

export const OUTBOX_STORE = 'outbox';
export const FAILED_STORE = 'failed';

/** First retry delay. Doubles per attempt up to {@link BACKOFF_CAP_MS}. */
const BACKOFF_BASE_MS = 1_000;

/** The backoff ceiling. A device offline for an hour still probes every ~30s. */
export const BACKOFF_CAP_MS = 30_000;

/** The idle drain tick — the "and every 30 seconds" trigger. */
export const DRAIN_INTERVAL_MS = 30_000;

/**
 * The delay before attempt number `attempts`, with jitter.
 *
 * Exponential, capped, then multiplied by `[0.5, 1)`. Jitter matters even for a
 * single client: several tabs share one worker but not one wall clock, and a
 * server coming back from an outage should not be hit by every device's queue
 * on the same tick.
 */
export function backoffDelay(
	attempts: number,
	random: () => number = Math.random,
): number {
	const exponential = BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
	const capped = Math.min(exponential, BACKOFF_CAP_MS);
	return Math.round(capped * (0.5 + 0.5 * random()));
}

/* -------------------------------------------------------------------------- */
/* IndexedDB helpers                                                          */
/* -------------------------------------------------------------------------- */

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/* -------------------------------------------------------------------------- */
/* The queue                                                                  */
/* -------------------------------------------------------------------------- */

export interface OutboxOptions {
	/** The live connection, or `null` while it is being reopened. */
	getDatabase(): IDBDatabase | null;
	/** Perform one attempt. Must not throw — a thrown error is treated as retryable. */
	send(row: OutboxRow): Promise<SendResult>;
	/** Called whenever `pending_count`, `failed` or `sync_state` changes. */
	onChange(snapshot: OutboxSnapshot): void;
	/** Called once per mutation that lands in the failed store. */
	onFailed?(operation: FailedOperation): void;
	scheduler?: OutboxScheduler;
}

export class Outbox {
	readonly #options: OutboxOptions;
	readonly #scheduler: OutboxScheduler;

	/** Single-flight guard: the queue is drained serially, by definition. */
	#draining: Promise<void> | null = null;
	/** A drain that was requested while one was already running. */
	#drain_again = false;
	#retry_timer: unknown = undefined;
	#interval_timer: unknown = undefined;
	#stopped = false;

	/** Mirrors of the two stores, so a snapshot never has to hit IndexedDB. */
	#pending_count = 0;
	#failed: FailedOperation[] = [];
	/** Whether the last completed attempt reached the server. */
	#online = true;
	#in_flight = false;

	constructor(options: OutboxOptions) {
		this.#options = options;
		this.#scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
	}

	/* ---------------------------------------------------------------------- */
	/* Snapshot                                                               */
	/* ---------------------------------------------------------------------- */

	snapshot(): OutboxSnapshot {
		return {
			pending_count: this.#pending_count,
			failed: this.#failed.map((row) => ({ ...row })),
			sync_state: this.syncState(),
		};
	}

	private syncState(): SyncState {
		if (this.#failed.length > 0) return 'error';
		if (this.#pending_count === 0) return 'synced';
		return this.#online || this.#in_flight ? 'syncing' : 'offline';
	}

	#notify(): void {
		this.#options.onChange(this.snapshot());
	}

	/**
	 * Load the counters from IndexedDB. Called on init, so a reload knows it has
	 * pending work before the first drain finishes.
	 */
	async hydrate(): Promise<void> {
		const db = this.#options.getDatabase();
		if (!db) return;
		this.#pending_count = await this.#count(db);
		this.#failed = await this.#allFailed(db);
		this.#notify();
	}

	/* ---------------------------------------------------------------------- */
	/* Store access                                                           */
	/* ---------------------------------------------------------------------- */

	#count(db: IDBDatabase): Promise<number> {
		if (!db.objectStoreNames.contains(OUTBOX_STORE)) return Promise.resolve(0);
		const txn = db.transaction(OUTBOX_STORE, 'readonly');
		return promisify(txn.objectStore(OUTBOX_STORE).count());
	}

	#allFailed(db: IDBDatabase): Promise<FailedOperation[]> {
		if (!db.objectStoreNames.contains(FAILED_STORE)) return Promise.resolve([]);
		const txn = db.transaction(FAILED_STORE, 'readonly');
		return promisify(txn.objectStore(FAILED_STORE).getAll()).then(
			(rows) => rows as FailedOperation[],
		);
	}

	/** Every queued row, in drain order. */
	async pending(entity_types?: readonly string[]): Promise<OutboxRow[]> {
		const db = this.#options.getDatabase();
		if (!db || !db.objectStoreNames.contains(OUTBOX_STORE)) return [];
		const txn = db.transaction(OUTBOX_STORE, 'readonly');
		const rows = (await promisify(txn.objectStore(OUTBOX_STORE).getAll())) as OutboxRow[];
		rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
		if (!entity_types) return rows;
		const wanted = new Set(entity_types);
		return rows.filter((row) => wanted.has(row.entity_type));
	}

	/**
	 * Append a mutation, returning it with the `seq` IndexedDB assigned.
	 *
	 * The key generator is per-store and persists across connections — it is not
	 * reset by deleting records or by `clear()` — so `seq` is monotonic across
	 * worker restarts without any bookkeeping of our own, and without a client
	 * clock (which must never order anything).
	 */
	async enqueue(row: Omit<OutboxRow, 'seq'>): Promise<OutboxRow> {
		const db = this.#options.getDatabase();
		if (!db || !db.objectStoreNames.contains(OUTBOX_STORE)) {
			throw new DelightError({
				message:
					'The offline outbox is unavailable — IndexedDB could not be opened. Mutations cannot be queued.',
				status: 503,
				code: 'outbox_unavailable',
			});
		}
		const txn = db.transaction(OUTBOX_STORE, 'readwrite');
		const seq = (await promisify(
			txn.objectStore(OUTBOX_STORE).add(row),
		)) as unknown as number;
		this.#pending_count += 1;
		this.#notify();
		return { ...row, seq: Number(seq) };
	}

	#delete(db: IDBDatabase, seq: number): Promise<void> {
		const txn = db.transaction(OUTBOX_STORE, 'readwrite');
		return promisify(txn.objectStore(OUTBOX_STORE).delete(seq)).then(() => undefined);
	}

	#put(db: IDBDatabase, row: OutboxRow): Promise<void> {
		const txn = db.transaction(OUTBOX_STORE, 'readwrite');
		return promisify(txn.objectStore(OUTBOX_STORE).put(row)).then(() => undefined);
	}

	/** Move one row out of the queue and into `failed`, in one transaction. */
	async #fail(
		db: IDBDatabase,
		row: OutboxRow,
		reason: FailureReason,
		error: { message: string; status: number; code?: string },
	): Promise<FailedOperation> {
		const failed: FailedOperation = {
			...row,
			seq: row.seq ?? 0,
			failed_at: this.#scheduler.now(),
			reason,
			error,
		};
		const txn = db.transaction([OUTBOX_STORE, FAILED_STORE], 'readwrite');
		txn.objectStore(OUTBOX_STORE).delete(failed.seq);
		txn.objectStore(FAILED_STORE).put(failed);
		await new Promise<void>((resolve, reject) => {
			txn.oncomplete = () => resolve();
			txn.onerror = () => reject(txn.error);
		});
		this.#pending_count = Math.max(0, this.#pending_count - 1);
		this.#failed.push(failed);
		this.#options.onFailed?.(failed);
		return failed;
	}

	/* ---------------------------------------------------------------------- */
	/* Failed-store API                                                       */
	/* ---------------------------------------------------------------------- */

	failed(): FailedOperation[] {
		return this.#failed.map((row) => ({ ...row }));
	}

	/**
	 * Put a failed mutation back in the queue.
	 *
	 * It re-enters at the **back**: its original `seq` was consumed when it left,
	 * and re-using it would let it overtake rows enqueued since. Ordering is only
	 * ever guaranteed for mutations that were queued together, so a retry chosen
	 * by a human minutes later is a new mutation as far as order goes — it keeps
	 * its `op_id`, so the server still applies it exactly once.
	 */
	async retryFailed(op_id: string): Promise<boolean> {
		const db = this.#options.getDatabase();
		if (!db) return false;
		const index = this.#failed.findIndex((row) => row.op_id === op_id);
		if (index === -1) return false;
		const [failed] = this.#failed.splice(index, 1);
		const txn = db.transaction(FAILED_STORE, 'readwrite');
		await promisify(txn.objectStore(FAILED_STORE).delete(op_id));
		const { seq: _seq, failed_at: _at, reason: _r, error: _e, ...row } = failed;
		await this.enqueue({ ...row, attempts: 0, next_attempt_at: 0 });
		void this.drain();
		return true;
	}

	/** Drop a failed mutation for good. The local optimistic state is the app's problem. */
	async discardFailed(op_id: string): Promise<boolean> {
		const db = this.#options.getDatabase();
		if (!db) return false;
		const index = this.#failed.findIndex((row) => row.op_id === op_id);
		if (index === -1) return false;
		this.#failed.splice(index, 1);
		const txn = db.transaction(FAILED_STORE, 'readwrite');
		await promisify(txn.objectStore(FAILED_STORE).delete(op_id));
		this.#notify();
		return true;
	}

	/* ---------------------------------------------------------------------- */
	/* Draining                                                               */
	/* ---------------------------------------------------------------------- */

	/** Start the idle tick. Safe to call repeatedly. */
	start(): void {
		this.#stopped = false;
		if (this.#interval_timer !== undefined) return;
		const tick = () => {
			this.#interval_timer = this.#scheduler.setTimeout(tick, DRAIN_INTERVAL_MS);
			void this.drain();
		};
		this.#interval_timer = this.#scheduler.setTimeout(tick, DRAIN_INTERVAL_MS);
	}

	stop(): void {
		this.#stopped = true;
		if (this.#interval_timer !== undefined) {
			this.#scheduler.clearTimeout(this.#interval_timer);
			this.#interval_timer = undefined;
		}
		this.#clearRetryTimer();
	}

	#clearRetryTimer(): void {
		if (this.#retry_timer === undefined) return;
		this.#scheduler.clearTimeout(this.#retry_timer);
		this.#retry_timer = undefined;
	}

	/**
	 * Send everything queued, oldest `seq` first, one at a time.
	 *
	 * Single-flighted, and a call made while a drain is running re-runs it once
	 * afterwards rather than interleaving — two concurrent drains would send the
	 * same row twice, which the server would dedupe but the ordering would not
	 * survive.
	 */
	drain(): Promise<void> {
		if (this.#draining) {
			this.#drain_again = true;
			return this.#draining;
		}
		this.#draining = this.#drainOnce()
			.catch((error) => {
				console.error('[database] outbox drain failed', error);
			})
			.finally(() => {
				this.#draining = null;
				if (this.#drain_again && !this.#stopped) {
					this.#drain_again = false;
					void this.drain();
				}
			});
		return this.#draining;
	}

	/**
	 * Resolve when the drain currently in flight (if any) has finished, WITHOUT
	 * asking for another one — `drain()` would queue a re-run and send again.
	 */
	async whenIdle(): Promise<void> {
		while (this.#draining) await this.#draining;
	}

	async #drainOnce(): Promise<void> {
		const db = this.#options.getDatabase();
		if (!db || !db.objectStoreNames.contains(OUTBOX_STORE)) return;
		this.#clearRetryTimer();

		for (;;) {
			if (this.#stopped) return;
			const queue = await this.pending();
			if (queue.length === 0) {
				this.#pending_count = 0;
				this.#notify();
				return;
			}
			this.#pending_count = queue.length;

			const row = queue[0];
			const wait = row.next_attempt_at - this.#scheduler.now();
			if (wait > 0) {
				this.#scheduleRetry(wait);
				this.#notify();
				return;
			}

			this.#in_flight = true;
			this.#notify();
			let result: SendResult;
			try {
				result = await this.#options.send(row);
			} catch {
				// A `send` that throws is a bug in the caller, not a rejection —
				// treat it as retryable so a mutation is never silently dropped.
				result = { ok: false, retry: true };
			}
			this.#in_flight = false;

			if (result.ok) {
				this.#online = true;
				await this.#delete(db, row.seq!);
				this.#pending_count = Math.max(0, this.#pending_count - 1);
				this.#notify();
				continue;
			}

			if (result.retry) {
				// Everything behind this row may depend on it, so the whole queue
				// waits. While offline that is also simply true: nothing else
				// would succeed either.
				this.#online = false;
				const attempts = row.attempts + 1;
				// One draw, used for both the persisted deadline and the timer.
				// Two draws would let the timer fire before the row is due, and
				// the drain would spin straight back into the `wait > 0` branch.
				const delay = backoffDelay(attempts, () => this.#scheduler.random());
				await this.#put(db, {
					...row,
					attempts,
					next_attempt_at: this.#scheduler.now() + delay,
				});
				this.#scheduleRetry(delay);
				this.#notify();
				return;
			}

			// A 4xx. The server reached a verdict, so the connection is fine and
			// the rest of the queue should keep moving — but not the mutations
			// that were queued against this row's outcome.
			this.#online = true;
			await this.#fail(db, row, 'rejected', result.error);
			await this.#failDependents(db, queue.slice(1), row);
			this.#notify();
		}
	}

	/**
	 * Fail every later mutation on the same row.
	 *
	 * The alternative — skipping the failed row and applying the rest — writes an
	 * update against a create that never happened, or resurrects a row whose
	 * delete was rejected. Both are silent corruption. The alternative in the
	 * other direction — stopping the queue — blocks unrelated edits behind one
	 * rejected title change, forever. So: unrelated mutations keep their order
	 * and keep draining; dependent ones fail together and surface together.
	 */
	async #failDependents(
		db: IDBDatabase,
		rest: readonly OutboxRow[],
		parent: OutboxRow,
	): Promise<void> {
		for (const row of rest) {
			if (
				row.entity_type !== parent.entity_type ||
				String(row.id) !== String(parent.id)
			) {
				continue;
			}
			await this.#fail(db, row, 'dependency_failed', {
				message: `Skipped because an earlier change to this ${parent.entity_type} was rejected.`,
				status: 409,
				code: 'dependency_failed',
			});
		}
	}

	#scheduleRetry(delay_ms: number): void {
		this.#clearRetryTimer();
		if (this.#stopped) return;
		this.#retry_timer = this.#scheduler.setTimeout(
			() => {
				this.#retry_timer = undefined;
				void this.drain();
			},
			Math.max(0, delay_ms),
		);
	}
}
