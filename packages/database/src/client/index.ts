export {
	DatabaseClient,
	EntityState,
	EntityReader,
	DatabaseWatch,
	type DatabaseClientConfig,
	type SearchHit,
	type SearchResult,
	type WatchQueryInit,
	type WatchStatus,
} from './database.client.svelte';

export { type WorkerSearchResult } from './database.worker';

export {
	type SearchQueryInput,
	type ValidSearchQuery,
	encodeSearchQuery,
	decodeSearchQuery,
} from '../search-query';
