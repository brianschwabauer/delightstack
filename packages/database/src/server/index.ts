export * from './database.handler.js';
export type * from '../contract.js';
export * from './sql.helper.js';
export { schemaSql } from './schema.sql.js';

// Note: DatabaseServer is intentionally NOT re-exported from this barrel.
// It imports cloudflare:workers which only resolves in the Workers runtime.
// Import it from '@delightstack/database/worker' in your Worker entry point.
export type {
	SqlDatabase,
	ExecStatement,
	Migration,
	MigrationContext,
	MigrationStatus,
	MigrationCheck,
} from './sql.database.js';
export type {
	DatabaseServer,
	DatabaseStub,
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
} from './db.server.js';
