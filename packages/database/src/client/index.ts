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
} from './database.client.svelte';

export { type WorkerSearchResult } from './database.worker';

export type {
	FailedOperation,
	FailureReason,
	OutboxOperation,
	OutboxSnapshot,
	SyncState,
} from './database.outbox';

export type { DatabaseClientHooks, DatabaseEntityChange } from '../contract';

export {
	type SearchQueryInput,
	type ValidSearchQuery,
	encodeSearchQuery,
	decodeSearchQuery,
} from '../search-query';
