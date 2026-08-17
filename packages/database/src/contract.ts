/**
 * The database ↔ websocket contract.
 *
 * `@delightstack/database` and `@delightstack/websocket` have no runtime
 * dependency on each other — they meet at these types. The database package
 * owns them because both halves are database concerns: `DatabaseServer`
 * broadcasts entity changes through a {@link DatabaseBroadcast}, and
 * `DatabaseClient` consumes live changes through {@link DatabaseClientHooks}.
 * The websocket package implements them (`implements` / return-type
 * annotations on `WebsocketServer.entityChanged` and
 * `WebsocketClient.databaseHooks`), so any drift between the two packages is
 * a compile error instead of a silent runtime mismatch.
 */

/** A CRUD change flowing between the database and an external live channel */
export interface DatabaseEntityChange {
	type: 'create' | 'update' | 'delete';
	entity_type: string;
	id: string | number;
	/** Full entity data for create/update; undefined for delete */
	data?: Record<string, unknown>;
	/**
	 * The server's sparse search-index projection of the entity, exactly as
	 * the server indexed it. Clients maintaining a local search index must
	 * insert THIS document — inserting the full `data` into an index built
	 * for the sparse schema fails validation and silently drops the document.
	 */
	sparse?: Record<string, unknown>;
}

/** One entity change inside a batched {@link DatabaseBroadcast} flush. */
export interface DatabaseBroadcastChange {
	action: 'created' | 'updated' | 'deleted';
	entity_type: string;
	id: string | number;
	data?: unknown;
	sparse?: unknown;
}

/**
 * The broadcast half of the contract: what `DatabaseServer` needs from the
 * WebSocket Durable Object passed to its constructor. `WebsocketServer` in
 * `@delightstack/websocket` implements this.
 */
export interface DatabaseBroadcast {
	entityChanged(
		action: 'created' | 'updated' | 'deleted',
		entity_type: string,
		id: string | number,
		data?: unknown,
		sparse?: unknown,
	): void;
	/**
	 * Batched form: one DO-to-DO RPC per transaction flush instead of one per
	 * mutated entity — a 5000-op `transaction()` must not make 5000 RPC calls.
	 * Wire delivery to clients stays one frame per change. Optional so a
	 * deployed DO from before this method still satisfies the contract;
	 * `DatabaseServer` falls back to per-entity `entityChanged` calls.
	 */
	entitiesChanged?(changes: DatabaseBroadcastChange[]): void;
}

/**
 * The hooks half of the contract: how a live channel plugs into
 * `DatabaseClient` (the `hooks` config option).
 * `WebsocketClient.databaseHooks()` in `@delightstack/websocket` returns this.
 */
export interface DatabaseClientHooks {
	/** Called after any local CRUD operation */
	onEntityChange?: (event: DatabaseEntityChange) => void;
	/** Called to subscribe to external changes; may return an unsubscribe fn */
	onSubscribe?: (callback: (event: DatabaseEntityChange) => void) => (() => void) | void;
	/**
	 * Optional predicate that answers "is there a reliable live change feed
	 * right now?" — typically wired to a websocket's connection state. When it
	 * returns `true`, the worker skips its safety-net stale-refresh because
	 * any recent server changes already landed via the change feed. When it
	 * returns `false` (or when the hook is absent), the worker falls back to
	 * refresh-if-stale so apps without a push channel still stay in sync.
	 */
	isLive?: () => boolean;
}
