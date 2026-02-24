/**
 * Lightweight IndexedDB wrapper for the database client.
 *
 * Stores:
 *   - entities   : cached entity data   (key = `{entity_type}/{id}`)
 *   - sync_meta  : per-entity sync state (key = entity_type)
 *   - search_index : serialised Orama indices (key = entity_type)
 */

const STORES = ['entities', 'sync_meta', 'search_index'] as const;

export type IDBStoreName = (typeof STORES)[number];

export interface SyncMeta {
	entity_type: string;
	search_mode: 'client' | 'server';
	config_version: number;
	last_synced_at: number;
	start_updated_at: number;
	end_updated_at: number;
}

export interface CachedEntity {
	entity_type: string;
	id: string | number;
	data: Record<string, unknown>;
	updated_at: number;
}

export interface CachedSearchIndex {
	entity_type: string;
	index: unknown;
	config_version: number;
	updated_at: number;
}

/** Opens (or creates) an IndexedDB database with the given name. */
export function openDatabase(db_name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(db_name, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			for (const store of STORES) {
				if (!db.objectStoreNames.contains(store)) {
					db.createObjectStore(store);
				}
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
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

/** Clear all entries from an object store. */
export function idbClear(db: IDBDatabase, store: IDBStoreName): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const request = tx.objectStore(store).clear();
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

/** Get all keys from an object store. */
export function idbGetAllKeys(db: IDBDatabase, store: IDBStoreName): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly');
		const request = tx.objectStore(store).getAllKeys();
		request.onsuccess = () => resolve(request.result as string[]);
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

/** Delete an entire IndexedDB database by name. */
export function deleteDatabase(db_name: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(db_name);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}
