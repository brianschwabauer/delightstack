// Cloudflare Worker exports — these depend on cloudflare:workers
// that only resolves inside the Cloudflare Workers runtime.
// SvelteKit apps should import from '@delightstack/database/server' instead.
export { DatabaseServer, scoped, DEFAULT_ACTOR } from '../server/db.server.js';
export { SqlDatabase } from '../server/sql.database.js';
export { schemaSql } from '../server/schema.sql.js';
export type {
	ExecStatement,
	Migration,
	MigrationContext,
	MigrationStatus,
	MigrationCheck,
	SqlDatabaseOptions,
} from '../server/sql.database.js';
export type {
	ScopedDatabase,
	WriteOptions,
	CreateOptions,
	OperationKind,
	AppliedOperation,
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
	DatabaseEmbedder,
	DatabaseServerOptions,
	SchemaReport,
	SearchReport,
	SearchFieldReport,
	SchemaDrift,
} from '../server/db.server.js';
