// The root entry is schema + types only, so importing `Database` never drags
// the SvelteKit handler or search runtime into a worker/client bundle.
// - SvelteKit handler (createDatabaseHandle): '@delightstack/database/server'
// - Durable Object class (DatabaseServer value): '@delightstack/database/worker'
// - Svelte 5 client (DatabaseClient): '@delightstack/database/client'
export * from './schema/schema.js';
export type * from './contract.js';
export * from './search-query.js';
export type * from './search/core/types.js';
export type {
	DatabaseServer,
	DatabaseStub,
	DatabaseSyncRequest,
	DatabaseSyncResponse,
	DatabaseServerTransaction,
	DatabaseServerTransactionResult,
	DatabaseEmbedder,
} from './server/db.server.js';
