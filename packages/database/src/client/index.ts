export {
	DatabaseClient,
	EntityState,
	EntityHandle,
	ListHandle,
	type DatabaseClientConfig,
	type SearchHit,
	type SearchResult,
	type ListQueryInit,
	type HandleStatus,
	type DatabaseStatus,
} from './database.client.svelte';

export { type WorkerSearchResult } from './database.worker';

export {
	type SearchQueryInput,
	type ValidSearchQuery,
	encodeSearchQuery,
	decodeSearchQuery,
} from '../search-query';
