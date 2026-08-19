// Cloudflare Worker exports — these depend on cloudflare:workers
// that only resolves inside the Cloudflare Workers runtime.
// SvelteKit apps should import from '@delightstack/database/server' instead.
export { DatabaseServer, scoped, DEFAULT_ACTOR } from '../server/db.server';
export type {
	ScopedDatabase,
	WriteOptions,
	ChangeLogEntry,
	HistoryOptions,
	ChangesSinceOptions,
	OperationChangesOptions,
	PendingFileDeletion,
	PendingFileDeletionsOptions,
	DatabaseSyncRequest,
	DatabaseSyncResponse,
	DatabaseServerTransaction,
	DatabaseServerTransactionResult,
} from '../server/db.server';
