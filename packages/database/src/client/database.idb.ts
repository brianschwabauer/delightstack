/**
 * Lightweight IndexedDB wrapper for the database client.
 *
 * Stores:
 *   - entities   : cached entity data   (key = `{entity_type}/{id}`)
 *   - sync_meta  : per-entity sync state (key = entity_type)
 *
 * The search index itself is NOT here: it lives in the four postings stores of
 * `search/client/idb_store.ts`, in this same database, so an index write and the
 * sync cursor that accounts for it commit in one transaction. The worker opens
 * the database through `openSearchDatabase` (which creates the stores below as
 * `extra_stores`); the helpers here operate on whichever connection it hands
 * them. The legacy `search_index` blob store is dropped on that upgrade.
 */

const STORES = ['entities', 'sync_meta'] as const;

export type IDBStoreName = (typeof STORES)[number];

export interface SyncMeta {
	entity_type: string;
	search_mode: 'client' | 'server';
	config_version: number;
	last_synced_at: number;
	/**
	 * The oldest 'updated_at' timestamp that has been synced.
	 * `undefined` means the entity has never synced; `0` means the full history
	 * has been backfilled. Anything in between means backfill is still in progress.
	 */
	start_updated_at: number | undefined;
	/** The newest 'updated_at' timestamp that has been synced (undefined = never synced) */
	end_updated_at: number | undefined;
	/**
	 * The server's last reported total row count for this entity's table.
	 * Carried so a reload knows a deferred entity (count > ceiling) before the
	 * first sync probe answers.
	 */
	server_total?: number;
	/**
	 * The server refused to sync this entity type (a permission decision, not a
	 * size one). Carried so a reload routes the type's queries to the server
	 * without re-attempting the backfill first.
	 */
	denied?: true;
}

export interface CachedEntity {
	entity_type: string;
	id: string | number;
	data: Record<string, unknown>;
	updated_at: number;
}

/** Generic get from an object store. */
export function idbGet<T>(
	db: IDBDatabase,
	store: IDBStoreName,
	key: string,
): Promise<T | undefined> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly');
		const request = tx.objectStore(store).get(key);
		request.onsuccess = () => resolve(request.result as T | undefined);
		request.onerror = () => reject(request.error);
	});
}

/** Generic put into an object store. */
export function idbPut(
	db: IDBDatabase,
	store: IDBStoreName,
	key: string,
	value: unknown,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const request = tx.objectStore(store).put(value, key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/** Generic delete from an object store. */
export function idbDelete(
	db: IDBDatabase,
	store: IDBStoreName,
	key: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const request = tx.objectStore(store).delete(key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/** Delete all entries whose key starts with the given prefix (e.g. `person/`). */
export function idbDeleteByPrefix(
	db: IDBDatabase,
	store: IDBStoreName,
	prefix: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
		const request = tx.objectStore(store).delete(range);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/** Batch multiple put/delete operations in a single transaction. */
export function idbBatch(
	db: IDBDatabase,
	ops: {
		store: IDBStoreName;
		type: 'put' | 'delete';
		key: string;
		value?: unknown;
	}[],
): Promise<void> {
	if (ops.length === 0) return Promise.resolve();

	// Collect unique stores needed for this batch
	const stores = [...new Set(ops.map((op) => op.store))];

	return new Promise((resolve, reject) => {
		const tx = db.transaction(stores, 'readwrite');
		for (const op of ops) {
			const store = tx.objectStore(op.store);
			if (op.type === 'put') {
				store.put(op.value, op.key);
			} else {
				store.delete(op.key);
			}
		}
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Delete an entire IndexedDB database by name.
 *
 * `deleteDatabase` blocks while other connections are open — callers must
 * close their own connection first, and peer connections are released through
 * the `versionchange` event the deletion fires on them (the worker's
 * `#attachVersionChange` handler closes on it). `onblocked` is therefore not
 * terminal here: the promise keeps waiting for the peers to let go.
 */
export function deleteDatabase(db_name: string, factory?: IDBFactory): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = (factory ?? indexedDB).deleteDatabase(db_name);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/**
 * How long a sibling delete may block before sign-out gives up on it. A
 * database another tab still holds open blocks forever (that tab has no reason
 * to release it — it is not the one signing out), and sign-out must not hang.
 */
const SIBLING_DELETE_TIMEOUT_MS = 2000;

/**
 * Delete the databases named by `select`, except `current` — best effort.
 *
 * This serves the per-org `db_name` pattern: signing out of one org must not
 * leave the other orgs' mirrors on disk. `current` is skipped because the
 * worker's own wipe already owns it (with the freeze semantics sign-out needs).
 *
 * A function `select` filters the names reported by `indexedDB.databases()`;
 * where that enumeration is unavailable there is nothing to filter and nothing
 * is deleted. Every delete is bounded by {@link SIBLING_DELETE_TIMEOUT_MS} and
 * its failure swallowed — a blocked sibling is a leftover database, never a
 * failed sign-out.
 */
export async function deleteSiblingDatabases(
	current: string,
	select: string[] | ((name: string) => boolean),
	factory?: IDBFactory,
): Promise<void> {
	const idb = factory ?? indexedDB;
	let names: string[];
	if (Array.isArray(select)) {
		names = select;
	} else {
		if (typeof idb.databases !== 'function') return;
		const entries = await idb.databases().catch(() => []);
		names = entries
			.map((entry) => entry.name)
			.filter((name): name is string => !!name && select(name));
	}

	const targets = [...new Set(names)].filter((name) => !!name && name !== current);
	await Promise.all(
		targets.map((name) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			return Promise.race([
				deleteDatabase(name, idb),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, SIBLING_DELETE_TIMEOUT_MS);
				}),
			])
				.catch(() => {})
				.finally(() => clearTimeout(timer));
		}),
	);
}
