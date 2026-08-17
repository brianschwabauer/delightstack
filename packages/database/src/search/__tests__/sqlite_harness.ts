/**
 * A real-SQLite harness for the server driver's tests.
 *
 * ## Why `node:sqlite`
 *
 * The existing server tests (`src/server/db.server*.test.ts`) do **not** run
 * against a real database at all — they hand `DatabaseServer` a hand-written
 * `{ exec: vi.fn() }` mock and assert on the SQL strings it emits. There is no
 * miniflare/workers pool in this package (`vite.config.ts` uses the
 * `edge-runtime` environment), so "the same infra as db.server.test.ts" would
 * mean asserting strings, which cannot validate a query engine.
 *
 * This harness therefore runs the driver against **real SQLite**, using Node's
 * built-in `node:sqlite` module: zero new dependencies (Brian's rule), a real
 * SQLite ≥3.47 with `WITHOUT ROWID`, VIRTUAL generated columns, `json_each`,
 * `RETURNING` and `PRAGMA table_xinfo` — every feature the plan's DO-SQLite
 * compatibility note verified. Test files that use it declare
 * `// @vitest-environment node`.
 *
 * The adapter below presents Cloudflare's `SqlStorage.exec(query, ...bindings)`
 * shape, so the driver code under test is byte-identical to what a Durable
 * Object will run.
 */

import { DatabaseSync } from 'node:sqlite';
import type { SearchSqlCursor, SearchSqlStorage } from '../server/sqlite_store';
import {
	generatedColumnStatements,
	planGeneratedColumns,
	quoteIdentifier,
} from '../server/sql_where';
import { defineServerTable, type ServerSearchTable } from '../server/engine';
import type { PrimaryKeyType } from '../core/compare';
import type { WhereSchema } from '../core/where';

/* -------------------------------------------------------------------------- */
/* SqlStorage adapter                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A `SqlStorage`-shaped façade over a `node:sqlite` database.
 *
 * **Statements are prepared once per SQL string**, like a Durable Object's.
 * `SqlStorage.exec` keeps a per-object statement cache keyed by the query text,
 * so a DO pays SQLite's parse/plan cost once per shape per boot — which is
 * exactly why the driver builds a small, fixed set of statement shapes and
 * chunks its `IN` lists instead of inlining values. Re-preparing on every call
 * would make the benchmark measure `sqlite3_prepare_v2` rather than the query,
 * and at ~0.1ms a prepare that is most of a paged read's budget.
 */
export class NodeSqlStorage implements SearchSqlStorage {
	readonly db: DatabaseSync;
	/** Every statement executed, for batching/param-cap assertions. */
	readonly log: { sql: string; params: unknown[] }[] = [];
	/** Whether to record statements — turn it off for benchmarks. */
	record = true;
	/** Query text → prepared statement, mirroring a DO's statement cache. */
	readonly #prepared = new Map<string, ReturnType<DatabaseSync['prepare']>>();

	constructor(db: DatabaseSync = new DatabaseSync(':memory:')) {
		this.db = db;
		this.db.exec('PRAGMA foreign_keys = OFF;');
	}

	exec(query: string, ...bindings: unknown[]): SearchSqlCursor {
		if (this.record) this.log.push({ sql: query, params: bindings });
		if (bindings.length === 0 && countStatements(query) > 1) {
			this.db.exec(query);
			return { toArray: () => [], [Symbol.iterator]: () => [][Symbol.iterator]() };
		}
		let statement = this.#prepared.get(query);
		if (!statement) {
			statement = this.db.prepare(query);
			this.#prepared.set(query, statement);
		}
		const rows = statement.all(...(bindings as never[])) as unknown as Record<
			string,
			unknown
		>[];
		// `node:sqlite` returns null-prototype objects; normalize so spreads,
		// `Object.keys` and vitest's matchers all behave like a DO cursor's rows.
		// Re-prototyping in place rather than spreading: a copy per row is real
		// work a DO cursor never does, and the term path reads tens of thousands.
		for (const row of rows) Object.setPrototypeOf(row, Object.prototype);
		return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
	}

	close(): void {
		this.#prepared.clear();
		this.db.close();
	}
}

/** Rough statement count — enough to route multi-statement DDL to `exec`. */
function countStatements(query: string): number {
	return query.split(';').filter((part) => part.trim().length > 0).length;
}

/* -------------------------------------------------------------------------- */
/* DurableObjectState adapter (for the db.server integration suite)           */
/* -------------------------------------------------------------------------- */

/** The cursor shape `db.server.ts` consumes: iterable, `next`, `one`, `toArray`. */
export interface DurableSqlCursor<Row = Record<string, unknown>> {
	toArray(): Row[];
	one(): Row;
	next(): { done: boolean; value: Row | undefined };
	[Symbol.iterator](): Iterator<Row>;
}

/** What {@link createDurableObjectState} hands back. */
export interface NodeDurableObjectState {
	/** The `DurableObjectState`-shaped object to pass as `ctx`. */
	ctx: {
		id: { toString(): string };
		storage: {
			sql: { exec(query: string, ...bindings: unknown[]): DurableSqlCursor };
			transactionSync<T>(callback: () => T): T;
			deleteAll(): void;
			deleteAlarm(): void;
		};
		abort(): void;
	};
	db: DatabaseSync;
	/** Every statement executed, in order. */
	log: { sql: string; params: unknown[] }[];
	close(): void;
}

/**
 * A `DurableObjectState` façade over `node:sqlite`, complete enough to run a
 * real `DatabaseServer`.
 *
 * The existing `db.server.*.test.ts` suites hand the server a hand-written
 * `{ exec: vi.fn() }` that pattern-matches SQL strings; it cannot catch semantic
 * breakage, which is exactly what a new storage engine introduces. This runs the
 * production class against a real SQLite instead.
 *
 * `transactionSync` is implemented with **SAVEPOINT**, not `BEGIN`: `batch()`
 * nests `transactionSync` inside `transactionSync`, and SQLite has no nested
 * `BEGIN`. Savepoints give the same all-or-nothing semantics at every depth,
 * which is what the rollback tests depend on.
 */
export function createDurableObjectState(id = 'test-do'): NodeDurableObjectState {
	const db = new DatabaseSync(':memory:');
	// Matches the harness above; the integration fixtures insert rows directly
	// (bypassing referential order), and DO SQLite's always-on foreign keys are
	// not what these tests are about.
	db.exec('PRAGMA foreign_keys = OFF;');
	const log: { sql: string; params: unknown[] }[] = [];
	let depth = 0;

	function cursor(rows: Record<string, unknown>[]): DurableSqlCursor {
		let index = 0;
		return {
			toArray: () => rows,
			one: () => {
				if (rows.length !== 1) {
					throw new Error(`Expected exactly one row, got ${rows.length}`);
				}
				return rows[0];
			},
			next: () =>
				index < rows.length
					? { done: false, value: rows[index++] }
					: { done: true, value: undefined },
			[Symbol.iterator]: function* () {
				for (; index < rows.length; index++) yield rows[index];
			},
		};
	}

	return {
		db,
		log,
		close: () => db.close(),
		ctx: {
			id: { toString: () => id },
			abort: () => {},
			storage: {
				deleteAll: () => {},
				deleteAlarm: () => {},
				sql: {
					exec(query: string, ...bindings: unknown[]): DurableSqlCursor {
						log.push({ sql: query, params: bindings });
						if (bindings.length === 0 && countStatements(query) > 1) {
							db.exec(query);
							return cursor([]);
						}
						const statement = db.prepare(query);
						const rows = statement.all(...(bindings as never[])) as unknown as Record<
							string,
							unknown
						>[];
						return cursor(rows.map((row) => ({ ...row })));
					},
				},
				transactionSync<T>(callback: () => T): T {
					const name = `dsp_${depth++}`;
					db.exec(`SAVEPOINT ${name};`);
					try {
						const result = callback();
						db.exec(`RELEASE ${name};`);
						return result;
					} catch (error) {
						db.exec(`ROLLBACK TO ${name};`);
						db.exec(`RELEASE ${name};`);
						throw error;
					} finally {
						depth--;
					}
				},
			},
		},
	};
}

/* -------------------------------------------------------------------------- */
/* Entity tables                                                              */
/* -------------------------------------------------------------------------- */

/** Declared type → SQLite column definition for a top-level scalar. */
function columnType(type: string): string {
	if (type === 'number') return 'NUMERIC';
	if (type === 'boolean') return 'INTEGER';
	if (type === 'string') return 'TEXT';
	// `enum` deliberately gets NO affinity: enum values may be numbers, and a
	// TEXT-affinity column would store `2` as `'2'`, breaking the DSL's strict
	// typed equality on read-back as well as in SQL. See the stage-2 note in
	// `sql_where.ts`.
	return '';
}

/** Whether a declared type lives in a real column (rather than `json`). */
export function isScalarColumnType(type: string): boolean {
	return type === 'string' || type === 'number' || type === 'boolean' || type === 'enum';
}

/** Everything needed to build an entity table for one flat schema. */
export interface EntityTableSpec {
	entity_type: string;
	table_name: string;
	schema: WhereSchema;
	primary_key: string;
	primary_key_type: PrimaryKeyType;
	derived_fields?: readonly string[];
}

/**
 * Create an entity table shaped exactly like `db.server.ts` creates one: a real
 * column per top-level scalar, everything else in the internal `json` overflow
 * column, plus the generated columns and indexes `sql_where.ts` plans.
 */
export function createEntityTable(
	sql: NodeSqlStorage,
	spec: EntityTableSpec,
): ServerSearchTable {
	const columns: string[] = [];
	const column_names = new Set<string>();
	const derived = new Set(spec.derived_fields ?? []);
	for (const path of Object.keys(spec.schema).sort()) {
		if (path.includes('.') || derived.has(path)) continue;
		const type = spec.schema[path];
		if (!isScalarColumnType(type)) continue;
		column_names.add(path);
		const definition = columnType(type);
		columns.push(
			path === spec.primary_key
				? `${quoteIdentifier(path)} ${definition} PRIMARY KEY`.replace('  ', ' ')
				: `${quoteIdentifier(path)} ${definition}`.trimEnd(),
		);
	}
	if (!column_names.has(spec.primary_key)) {
		column_names.add(spec.primary_key);
		columns.unshift(
			`${quoteIdentifier(spec.primary_key)} ${spec.primary_key_type === 'number' ? 'INTEGER' : 'TEXT'} PRIMARY KEY`,
		);
	}
	columns.push('"json" TEXT');
	sql.exec(
		`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(spec.table_name)} (${columns.join(', ')});`,
	);

	const table = defineServerTable({
		entity_type: spec.entity_type,
		table_name: spec.table_name,
		schema: spec.schema,
		primary_key: spec.primary_key,
		primary_key_type: spec.primary_key_type,
		columns: column_names,
		derived_fields: derived.size > 0 ? derived : undefined,
	});
	for (const generated of planGeneratedColumns({
		table_name: spec.table_name,
		schema: spec.schema,
		columns: column_names,
		derived_fields: derived.size > 0 ? derived : undefined,
		primary_key: spec.primary_key,
	})) {
		for (const statement of generatedColumnStatements(spec.table_name, generated)) {
			sql.exec(statement);
		}
	}
	return table;
}

/**
 * Split a document into the entity row `db.server.ts` would write: scalars into
 * their columns, everything else (objects, arrays, vectors, geopoints) into
 * `json`, `null`/`undefined` dropped exactly as `toSparse` drops them.
 */
export function toEntityRow(
	table: ServerSearchTable,
	document: Record<string, unknown>,
): { columns: string[]; values: unknown[] } {
	const overflow: Record<string, unknown> = {};
	const derived: Record<string, unknown> = {};
	const columns: string[] = [];
	const values: unknown[] = [];
	for (const key of Object.keys(document).sort()) {
		const value = document[key];
		if (value === null || value === undefined) continue;
		if (table.derived_fields?.has(key)) {
			derived[key] = value;
			continue;
		}
		if (table.columns.has(key)) {
			columns.push(key);
			values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
			continue;
		}
		overflow[key] = stripNullish(value);
	}
	if (Object.keys(derived).length > 0) overflow.$derived = derived;
	columns.push('json');
	values.push(JSON.stringify(overflow));
	return { columns, values };
}

/** Drop `null`/`undefined` at every depth, exactly like `table.toSparse()`. */
function stripNullish(value: unknown): unknown {
	if (Array.isArray(value)) return value;
	if (value === null || typeof value !== 'object') return value;
	const stripped: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const child = (value as Record<string, unknown>)[key];
		if (child === null || child === undefined) continue;
		stripped[key] = stripNullish(child);
	}
	return stripped;
}

/** Insert one document as an entity row. */
export function insertEntityRow(
	sql: NodeSqlStorage,
	table: ServerSearchTable,
	document: Record<string, unknown>,
): void {
	const { columns, values } = toEntityRow(table, document);
	sql.exec(
		`INSERT OR REPLACE INTO ${quoteIdentifier(table.table_name)} (${columns
			.map(quoteIdentifier)
			.join(
				', ',
			)}) VALUES (${Array.from({ length: columns.length }, () => '?').join(', ')});`,
		...values,
	);
}
