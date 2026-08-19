/**
 * The schema subsystem entry point.
 *
 * The implementation is split across three modules:
 * - `field-types.ts` — field interfaces + the type-level helpers
 * - `generators.ts` — the field builder classes (`schema.string()`, …)
 * - `table.ts` — `Database.table()` and the `Database` namespace types
 * - `validation.ts` — the in-house field validators (replaces zod)
 *
 * This file re-exports everything so existing `from '../schema/schema'`
 * imports keep working.
 */
export { Database } from './table';
export type { FieldGenerator } from './generators';
export { FieldValidator } from './validation';
export { resolveFile, type FileStore } from './file';
export type { FileReference } from './field-types';
