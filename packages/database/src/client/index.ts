export {
	DatabaseClient,
	EntityState,
	EntityHandle,
	ListHandle,
	type DatabaseClientConfig,
	type SearchHit,
	type SearchResult,
	type ListQueryInit,
	type ListDocument,
	type HandleStatus,
	type DatabaseStatus,
	type ListOptions,
} from './database.client.svelte.js';

export { type WorkerSearchResult } from './database.worker.js';

export type {
	FailedOperation,
	FailureReason,
	OutboxOperation,
	OutboxSnapshot,
	SyncState,
} from './database.outbox.js';

export type { DatabaseClientHooks, DatabaseEntityChange } from '../contract.js';

export {
	type SearchQueryInput,
	type ValidSearchQuery,
	encodeSearchQuery,
	decodeSearchQuery,
} from '../search-query.js';
