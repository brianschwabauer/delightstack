// The root entry is schema + types only, so importing `Database` never drags
// the SvelteKit handler or search runtime into a worker/client bundle.
// - SvelteKit handler (createDatabaseHandle): '@delightstack/database/server'
// - Durable Object class (DatabaseServer value): '@delightstack/database/worker'
// - Svelte 5 client (DatabaseClient): '@delightstack/database/client'
export * from './schema/schema';
export type * from './contract';
export * from './search-query';
export type * from './search/core/types';
export type {
	DatabaseServer,
	DatabaseStub,
	DatabaseSyncRequest,
	DatabaseSyncResponse,
	DatabaseServerTransaction,
	DatabaseServerTransactionResult,
} from './server/db.server';
