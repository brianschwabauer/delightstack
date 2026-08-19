/**
 * `@delightstack/crdt/server` — the Durable Object half.
 *
 * Everything exported here imports Loro through `../loro.server.js`, which
 * pins `loro-crdt/bundler`. Importing this entry from a browser bundle would
 * pull in a wasm build that cannot stream; importing the client entry into
 * workerd pulls in one that throws at module scope. The split is the point.
 */
export {
	CrdtDocumentServer,
	DEFAULT_COMPACT_THRESHOLD_BYTES,
	DEFAULT_INLINE_SNAPSHOT_MAX_BYTES,
	DEFAULT_PEER_FLOOR_TTL_MS,
} from './document.server.js';
export { DEFAULT_SESSION_GAP_MS, deriveSessions } from './sessions.js';
export {
	EMPTY_FRONTIER,
	decodeFrontier,
	encodeFrontier,
	fromBase64,
	toBase64,
} from './frontier.js';
export { SCHEMA_STATEMENTS } from './schema.js';
export * from '../types.js';
