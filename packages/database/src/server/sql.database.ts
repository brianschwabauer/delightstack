/**
 * `SqlDatabase` — a Durable Object base for apps that want SQLite and
 * nothing else: numbered migrations, typed `exec`, one-round-trip `execMany`,
 * `explainSql`, and the database size.
 *
 * `DatabaseServer` extends it and adds the declarative schema, validation,
 * search, sync, history and change capture on top.
 */

import { DurableObject } from 'cloudflare:workers';
import { DelightError } from '@delightstack/utilities';

/** One `execMany()` statement: the SQL followed by its bindings. */
export type ExecStatement = readonly [sql: string, ...bindings: SqlStorageValue[]];

/** The most statements one `execMany()` call accepts. */
const EXEC_MANY_LIMIT = 100;

/** DO SQLite's bound-parameter ceiling — the most `explainSql()` will try. */
const MAX_EXPLAIN_BINDINGS = 100;

/** What a read-only statement may start with. */
export const READ_ONLY_STATEMENT = /^\s*(SELECT|WITH|VALUES|PRAGMA|EXPLAIN)\b/i;

/**
 * The PRAGMAs `execMany()` accepts: schema introspection only. Others either
 * write (`PRAGMA user_version = 2`) or change how every later query on the
 * connection behaves (`PRAGMA case_sensitive_like = 1`), and neither shows
 * up in `rowsWritten`.
 */
const READ_ONLY_PRAGMA =
	/^\s*PRAGMA\s+(table_info|table_xinfo|table_list|index_list|index_info|index_xinfo|foreign_key_list|foreign_key_check|data_version)\s*(\(\s*[^)]*\))?\s*;?\s*$/i;

/**
 * Whether a statement is, or `EXPLAIN`s, a PRAGMA outside the read-only
 * allowlist. `EXPLAIN` doesn't help: SQLite applies flag pragmas
 * (`case_sensitive_like`, `foreign_keys`) when it prepares the statement.
 */
function isUnsafePragma(sql: string): boolean {
	const inner = skipLeadingComments(
		skipLeadingComments(sql).replace(/^EXPLAIN(\s+QUERY\s+PLAN)?\b/i, ''),
	);
	return /^PRAGMA\b/i.test(inner) && !READ_ONLY_PRAGMA.test(inner);
}

/** The text after any leading whitespace and comments. */
function skipLeadingComments(sql: string): string {
	let rest = sql;
	for (;;) {
		const trimmed = rest.replace(/^\s+/, '');
		if (trimmed.startsWith('--')) {
			const end = trimmed.indexOf('\n');
			rest = end === -1 ? '' : trimmed.slice(end + 1);
		} else if (trimmed.startsWith('/*')) {
			const end = trimmed.indexOf('*/', 2);
			rest = end === -1 ? '' : trimmed.slice(end + 2);
		} else {
			return trimmed;
		}
	}
}

/**
 * Whether the text holds more than one statement: a `;` with anything but
 * whitespace or comments after it. String literals, quoted identifiers and
 * comments are skipped, so `WHERE name = 'a;b'` is one statement.
 */
export function hasSeveralStatements(sql: string): boolean {
	let i = 0;
	let ended = false;
	while (i < sql.length) {
		const char = sql[i];
		const next = sql[i + 1];
		if (char === '-' && next === '-') {
			const end = sql.indexOf('\n', i);
			i = end === -1 ? sql.length : end + 1;
			continue;
		}
		if (char === '/' && next === '*') {
			const end = sql.indexOf('*/', i + 2);
			i = end === -1 ? sql.length : end + 2;
			continue;
		}
		if (/\s/.test(char)) {
			i++;
			continue;
		}
		// Anything else after a statement-ending `;` is a second statement.
		if (ended) return true;
		if (char === ';') {
			ended = true;
			i++;
			continue;
		}
		if (char === "'" || char === '"' || char === '`') {
			// A doubled quote is an escaped one; either way the scan resumes
			// after the next quote character.
			let j = i + 1;
			for (;;) {
				const end = sql.indexOf(char, j);
				if (end === -1) return false; // unterminated: SQLite rejects it
				if (sql[end + 1] === char) {
					j = end + 2;
					continue;
				}
				i = end + 1;
				break;
			}
			continue;
		}
		if (char === '[') {
			const end = sql.indexOf(']', i + 1);
			i = end === -1 ? sql.length : end + 1;
			continue;
		}
		i++;
	}
	return false;
}

/** The table that records which migrations have run. */
export const MIGRATIONS_TABLE = '_migrations';

/**
 * One schema or data change, run once per database, in array order.
 *
 * @example
 * const migrations: Migration[] = [
 * 	{
 * 		id: '0001_relax_address',
 * 		// Agreements have no address: store NULL instead of ''
 * 		up: (m) => {
 * 			m.alterColumn('deal', 'address');
 * 			m.exec(`UPDATE deal SET address = NULL WHERE address = ''`);
 * 		},
 * 	},
 * ];
 */
export interface Migration {
	/**
	 * Unique and stable forever. Migrations run in array order, so new ones go
	 * at the end; the id only identifies it. Convention: `0007_what_it_does`.
	 */
	id: string;
	/**
	 * The change. Runs inside one transaction: if it throws, nothing it did is
	 * kept, the failure is logged and reported (`migrationStatus()`), the
	 * migrations after it wait, and it is retried on the next wake. The rest
	 * of the database keeps serving.
	 */
	up(migration: MigrationContext): void;
	/**
	 * Ship the migration without applying it: it is skipped on wake and only
	 * dry-run by `checkMigrations()`. Deploy with `preflight: true`, call
	 * `checkMigrations()` on every tenant to find the ones it would fail on,
	 * fix them, then deploy again without the flag.
	 */
	preflight?: boolean;
}

/** What a migration's `up()` can do. */
export interface MigrationContext {
	/** Run one statement. */
	exec<Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
		sql: string,
		...bindings: SqlStorageValue[]
	): Row[];
	/**
	 * Change one column's definition — nullability, type, default, CHECK — by
	 * swapping in a new column: add it, copy the values, drop the old one,
	 * rename. Indexes on the column are re-created; child rows and foreign
	 * keys are untouched.
	 *
	 * `definition` defaults to what the declared schema says (when there is
	 * one). `copy` is the SQL expression the new values come from, `column` by
	 * default — `NULLIF(address, '')`, say.
	 *
	 * Refuses a column that is the primary key, `UNIQUE`, or a `NOT NULL`
	 * foreign key: SQLite can't swap those, so use `rebuildTable()`.
	 *
	 * A `NOT NULL` column without a default comes out with one (`DEFAULT ''`
	 * or `0`): SQLite won't add a `NOT NULL` column to a populated table
	 * otherwise. A raw `INSERT` that omits the column then gets that value
	 * instead of an error.
	 */
	alterColumn(
		table: string,
		column: string,
		options?: { definition?: string; copy?: string },
	): void;
	/**
	 * Re-create the whole table — for what a column swap can't do: a primary
	 * key, a `UNIQUE` column, a `NOT NULL` foreign key, column order.
	 *
	 * `definition` maps every column to its SQL definition and defaults to the
	 * declared schema. `copy` maps a new column to the SQL expression that
	 * fills it; a column that exists in both keeps its values.
	 *
	 * Refuses a table another table references by foreign key. Dropping the old
	 * table would run SQLite's implicit `DELETE` against it and cascade into
	 * the children (`ON DELETE CASCADE` deletes them — measured, not
	 * theoretical), and the switch that prevents that can't be turned off
	 * inside a transaction. Change such a table column by column instead.
	 */
	rebuildTable(
		table: string,
		options?: { definition?: Record<string, string>; copy?: Record<string, string> },
	): void;
	/** Drop a column, and the indexes that use it first. */
	dropColumn(table: string, column: string): void;
	/** The live columns of a table, as `PRAGMA table_xinfo` reports them. */
	columns(table: string): { name: string; type: string; notnull: boolean; pk: boolean }[];
}

/** Where a database's migrations stand. */
export interface MigrationStatus {
	applied: string[];
	/** Not applied yet, in the order they will run (preflight ones included). */
	pending: string[];
	/** Tried and rolled back, with the error. Retried on the next wake. */
	failed: { id: string; error: string }[];
}

/** One `checkMigrations()` result. */
export interface MigrationCheck {
	id: string;
	ok: boolean;
	error?: string;
}

/** Thrown inside a dry run to roll it back. */
const DRY_RUN_ROLLBACK = Symbol('dry-run rollback');

export interface SqlDatabaseOptions {
	/** Applied in order on wake. A brand-new database runs all of them. */
	migrations?: Migration[];
}

/** A Durable Object over its own SQLite database. */
export class SqlDatabase<Env = unknown> extends DurableObject<Env> {
	/** The migrations this version of the code declares, in order. */
	#migrations: Migration[] = [];

	/** Migrations that failed on this wake. */
	#migration_failures: { id: string; error: string }[] = [];

	constructor(ctx: DurableObjectState, env: Env, options?: SqlDatabaseOptions) {
		super(ctx, env);
		if (options?.migrations)
			this.runMigrations(options.migrations, { baseline_if_fresh: false });
	}

	/**
	 * Run one statement and return its rows. The type argument names the row
	 * shape — `Database.Row<typeof table>`, or a `Pick` of it.
	 */
	exec<Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
		sql_statement: string,
		...bindings: any[]
	): Row[] {
		return this.ctx.storage.sql.exec(sql_statement, ...bindings).toArray() as Row[];
	}

	/**
	 * Run several read-only statements in one call and return one row array
	 * per statement, in order.
	 *
	 * Over RPC this is one Durable Object round trip instead of one per query:
	 * a page that needs ten reads waits for one hop, and the DO answers all
	 * ten in-process. The statements run inside one transaction, so every
	 * result comes from the same snapshot.
	 *
	 * Writes are refused. Each entry is one statement starting with `SELECT`,
	 * `WITH`, `VALUES`, `EXPLAIN` or a schema-introspection `PRAGMA`
	 * (`table_info`, `index_list`, …), and any statement that still writes a
	 * row (a `WITH … INSERT`) rolls the whole call back with a 400. Use
	 * `transaction()` (or `exec`) to write.
	 *
	 * @example
	 * const [deals, documents] = await db.execMany<[DealRow, DocumentRow]>([
	 * 	['SELECT * FROM deal WHERE id = ?', id],
	 * 	['SELECT * FROM document WHERE deal_id = ? ORDER BY created_at', id],
	 * ]);
	 */
	execMany<
		Rows extends readonly Record<string, SqlStorageValue>[] = Record<
			string,
			SqlStorageValue
		>[],
	>(statements: readonly ExecStatement[]): { [K in keyof Rows]: Rows[K][] } {
		if (!Array.isArray(statements)) {
			throw DelightError.badRequest(
				'execMany() takes an array of [sql, ...bindings] tuples',
			);
		}
		if (statements.length > EXEC_MANY_LIMIT) {
			throw DelightError.badRequest(
				`execMany() runs at most ${EXEC_MANY_LIMIT} statements per call (got ${statements.length})`,
			);
		}
		for (const statement of statements) {
			const sql = Array.isArray(statement) ? statement[0] : undefined;
			if (
				typeof sql !== 'string' ||
				!READ_ONLY_STATEMENT.test(sql) ||
				// `SELECT 1; DROP TABLE x`: DDL writes no counted row, so the
				// rowsWritten guard below can't see it.
				hasSeveralStatements(sql) ||
				isUnsafePragma(sql)
			) {
				throw new DelightError({
					message: `execMany() is read-only and takes one statement per entry; this is not a single read: ${String(sql).slice(0, 80)}`,
					status: 400,
					code: 'exec_many_not_read_only',
				});
			}
		}
		return this.ctx.storage.transactionSync(() =>
			statements.map(([sql, ...bindings]) => {
				const cursor = this.ctx.storage.sql.exec(sql, ...bindings);
				const rows = cursor.toArray();
				// A `WITH … INSERT` passes the prefix check, so the billed write
				// count is the real guard. Throwing rolls the transaction back.
				if (typeof cursor.rowsWritten === 'number' && cursor.rowsWritten > 0) {
					throw new DelightError({
						message: `execMany() is read-only; this statement wrote ${cursor.rowsWritten} row(s): ${sql.slice(0, 80)}`,
						status: 400,
						code: 'exec_many_not_read_only',
					});
				}
				return rows;
			}),
		) as unknown as { [K in keyof Rows]: Rows[K][] };
	}

	/**
	 * Check a statement against the live schema without running it: throws a
	 * 400 naming the problem when it references a table or column that does
	 * not exist, or does not parse.
	 *
	 * Meant for tests. Keep an app's queries in named constants and assert
	 * every one of them explains cleanly, so a renamed column fails the suite
	 * instead of a page in production. Bound parameters are left NULL.
	 */
	explainSql(sql_statement: string): void {
		if (typeof sql_statement !== 'string' || !sql_statement.trim()) {
			throw DelightError.badRequest('explainSql() needs a SQL statement');
		}
		// EXPLAIN prefixes only the first statement: a second one would run.
		if (hasSeveralStatements(sql_statement)) {
			throw DelightError.badRequest('explainSql() takes a single statement');
		}
		if (isUnsafePragma(sql_statement)) {
			throw DelightError.badRequest(
				'explainSql() does not take a PRAGMA that changes settings (SQLite applies it while preparing)',
			);
		}
		// Durable Object SQLite refuses a statement whose bindings don't match
		// its parameter count (node's SQLite reads missing ones as NULL), and
		// nothing reports the count up front, so grow a list of NULLs until the
		// count fits. Only EXPLAIN runs, so no attempt touches a row.
		let last_error: unknown;
		for (let count = 0; count <= MAX_EXPLAIN_BINDINGS; count++) {
			try {
				this.ctx.storage.sql
					.exec(`EXPLAIN ${sql_statement}`, ...new Array(count).fill(null))
					.toArray();
				return;
			} catch (error) {
				last_error = error;
				if (
					!/wrong number of (parameter )?bindings/i.test(DelightError.from(error).message)
				) {
					break;
				}
			}
		}
		throw new DelightError({
			message: `SQL does not match the schema: ${DelightError.from(last_error).message}`,
			status: 400,
			code: 'invalid_sql',
		});
	}

	/** The SQLite database's size on disk, in bytes (what storage is billed on). */
	databaseSize(): number {
		return this.ctx.storage.sql.databaseSize;
	}

	/* ---------------------------------------------------------------------- */
	/* Migrations                                                             */
	/* ---------------------------------------------------------------------- */

	/**
	 * Apply the pending migrations, in order, each in its own transaction.
	 *
	 * `baseline_if_fresh`: a database with no tables yet is recorded as having
	 * applied every migration without running any — right when something else
	 * (DatabaseServer's declared schema) creates the tables at their current
	 * shape. A plain `SqlDatabase` builds its tables *with* migrations, so it
	 * runs them all.
	 */
	protected runMigrations(
		migrations: Migration[],
		options: { baseline_if_fresh: boolean; fresh?: boolean | (() => boolean) },
	): MigrationStatus {
		this.#migrations = migrations;
		const seen = new Set<string>();
		for (const migration of migrations) {
			if (!migration?.id || typeof migration.up !== 'function') {
				throw new DelightError({
					message: 'Every migration needs an id and an up() function.',
					status: 500,
					code: 'invalid_migration',
				});
			}
			if (seen.has(migration.id)) {
				throw new DelightError({
					message: `Migration id '${migration.id}' is declared twice.`,
					status: 500,
					code: 'invalid_migration',
				});
			}
			seen.add(migration.id);
		}
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id TEXT PRIMARY KEY, applied_at INTEGER, error TEXT);`,
		);
		const applied = this.appliedMigrations();
		// Only worth asking whether the database is new when a migration is
		// still unrecorded (on a steady-state wake, none is).
		const unrecorded = migrations.some((migration) => !applied.has(migration.id));
		const fresh =
			unrecorded &&
			options.baseline_if_fresh &&
			(typeof options.fresh === 'function'
				? options.fresh()
				: (options.fresh ?? !this.hasUserTables()));
		if (fresh) {
			const now = Date.now();
			this.ctx.storage.transactionSync(() => {
				// Preflight ones too: a new database is already at the shape they
				// lead to, so there is nothing for them to do here.
				for (const migration of migrations) {
					this.ctx.storage.sql.exec(
						`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?);`,
						migration.id,
						now,
					);
				}
			});
			return this.migrationStatus();
		}
		this.#migration_failures = [];
		for (const migration of migrations) {
			if (applied.has(migration.id)) continue;
			if (migration.preflight) continue;
			try {
				this.ctx.storage.transactionSync(() => {
					migration.up(this.migrationContext());
					this.ctx.storage.sql.exec(
						`INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (id, applied_at, error) VALUES (?, ?, NULL);`,
						migration.id,
						Date.now(),
					);
				});
				console.log(`Applied migration ${migration.id}`);
			} catch (error) {
				const message = DelightError.from(error).message;
				console.error(`Migration ${migration.id} failed and was rolled back: ${message}`);
				this.#migration_failures.push({ id: migration.id, error: message });
				this.ctx.storage.sql.exec(
					`INSERT OR REPLACE INTO ${MIGRATIONS_TABLE} (id, applied_at, error) VALUES (?, NULL, ?);`,
					migration.id,
					message,
				);
				// Later migrations may depend on this one: they wait for it.
				break;
			}
		}
		return this.migrationStatus();
	}

	/** Which declared migrations have run, are waiting, or failed. */
	migrationStatus(): MigrationStatus {
		const rows = this.tableExists(MIGRATIONS_TABLE)
			? this.ctx.storage.sql
					.exec(`SELECT id, applied_at, error FROM ${MIGRATIONS_TABLE};`)
					.toArray()
			: [];
		const by_id = new Map(rows.map((row) => [String(row.id), row]));
		const applied: string[] = [];
		const pending: string[] = [];
		const failed: { id: string; error: string }[] = [];
		for (const migration of this.#migrations) {
			const row = by_id.get(migration.id);
			if (row && row.applied_at !== null && row.error === null)
				applied.push(migration.id);
			else {
				pending.push(migration.id);
				if (row?.error) failed.push({ id: migration.id, error: String(row.error) });
			}
		}
		return { applied, pending, failed };
	}

	/**
	 * Dry-run every pending migration — `preflight` ones included — against
	 * this database's real data, then roll all of it back. Nothing is kept.
	 *
	 * Call it on every tenant after deploying a `preflight: true` migration to
	 * find the databases it would fail on before it is applied anywhere.
	 */
	checkMigrations(): MigrationCheck[] {
		const applied = this.appliedMigrations();
		const results: MigrationCheck[] = [];
		try {
			this.ctx.storage.transactionSync(() => {
				for (const migration of this.#migrations) {
					if (applied.has(migration.id)) continue;
					try {
						this.ctx.storage.transactionSync(() => migration.up(this.migrationContext()));
						results.push({ id: migration.id, ok: true });
					} catch (error) {
						results.push({
							id: migration.id,
							ok: false,
							error: DelightError.from(error).message,
						});
						break;
					}
				}
				throw DRY_RUN_ROLLBACK;
			});
		} catch (error) {
			if (error !== DRY_RUN_ROLLBACK) throw error;
		}
		return results;
	}

	/**
	 * Hooks around a migration helper changing a table's structure, for
	 * subclasses whose triggers reference its columns (SQLite refuses to drop
	 * a column a trigger names). `before` runs first, `after` once the table
	 * has its new shape.
	 */
	protected beforeTableAlter(_table: string): void {}
	protected afterTableAlter(_table: string): void {}

	/** The declared definition of a column, for subclasses with a schema. */
	protected declaredColumn(_table: string, _column: string): string | undefined {
		return undefined;
	}

	/** Every declared column of a table, in order, for subclasses with a schema. */
	protected declaredTable(_table: string): Record<string, string> | undefined {
		return undefined;
	}

	private appliedMigrations(): Set<string> {
		if (!this.tableExists(MIGRATIONS_TABLE)) return new Set();
		return new Set(
			this.ctx.storage.sql
				.exec(
					`SELECT id FROM ${MIGRATIONS_TABLE} WHERE applied_at IS NOT NULL AND error IS NULL;`,
				)
				.toArray()
				.map((row) => String(row.id)),
		);
	}

	private tableExists(name: string): boolean {
		return !this.ctx.storage.sql
			.exec(
				`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1;`,
				name,
			)
			.next().done;
	}

	/** Any table that isn't SQLite's or Cloudflare's own. */
	private hasUserTables(): boolean {
		return !this.ctx.storage.sql
			.exec(
				`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != ? LIMIT 1;`,
				MIGRATIONS_TABLE,
			)
			.next().done;
	}

	private migrationContext(): MigrationContext {
		const sql = this.ctx.storage.sql;
		const q = quoteIdentifier;
		const columns = (table: string) =>
			sql
				.exec(`PRAGMA table_xinfo(${q(table)});`)
				.toArray()
				.filter((row) => Number(row.hidden ?? 0) === 0)
				.map((row) => ({
					name: String(row.name),
					type: String(row.type ?? ''),
					notnull: Number(row.notnull) === 1,
					pk: Number(row.pk) > 0,
				}));
		const requireTable = (table: string) => {
			assertIdentifier(table, 'table');
			if (!this.tableExists(table)) {
				throw new DelightError({
					message: `Table '${table}' does not exist.`,
					status: 500,
				});
			}
		};
		/** Indexes that cover a column (or every index on the table), with their DDL. */
		const indexesOn = (table: string, column?: string) =>
			sql
				.exec(
					`SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL;`,
					table,
				)
				.toArray()
				.map((row) => ({ name: String(row.name), sql: String(row.sql) }))
				.filter(
					(index) =>
						column === undefined ||
						sql
							.exec(`PRAGMA index_xinfo(${q(index.name)});`)
							.toArray()
							.some((info) => String(info.name) === column) ||
						// Expression and partial indexes name the column in their SQL
						new RegExp(`(^|[^A-Za-z0-9_])"?${column}"?([^A-Za-z0-9_]|$)`).test(
							index.sql.replace(/^CREATE.*? ON [^(]*/i, ''),
						),
				);
		const context: MigrationContext = {
			exec: (statement, ...bindings) =>
				sql.exec(statement, ...bindings).toArray() as never,
			columns: (table) => {
				requireTable(table);
				return columns(table);
			},
			dropColumn: (table, column) => {
				requireTable(table);
				assertIdentifier(column, 'column');
				this.beforeTableAlter(table);
				for (const index of indexesOn(table, column)) {
					sql.exec(`DROP INDEX ${q(index.name)};`);
				}
				sql.exec(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)};`);
				this.afterTableAlter(table);
			},
			alterColumn: (table, column, options) => {
				requireTable(table);
				assertIdentifier(column, 'column');
				const live = columns(table).find((c) => c.name === column);
				if (!live) {
					throw new DelightError({
						message: `Column '${table}.${column}' does not exist.`,
						status: 500,
					});
				}
				if (live.pk) {
					throw new DelightError({
						message: `'${table}.${column}' is the primary key; use rebuildTable('${table}').`,
						status: 500,
					});
				}
				const definition = options?.definition ?? this.declaredColumn(table, column);
				if (!definition) {
					throw new DelightError({
						message: `alterColumn('${table}', '${column}') needs a definition: the column is not in the declared schema.`,
						status: 500,
					});
				}
				if (/\bUNIQUE\b/i.test(definition) || isUniqueColumn(sql, table, column)) {
					throw new DelightError({
						message: `'${table}.${column}' is UNIQUE; SQLite can't swap a UNIQUE column. Use rebuildTable('${table}').`,
						status: 500,
					});
				}
				if (/\bREFERENCES\b/i.test(definition) && /\bNOT\s+NULL\b/i.test(definition)) {
					throw new DelightError({
						message: `'${table}.${column}' would be a NOT NULL foreign key, which SQLite can't add as a column. Use rebuildTable('${table}').`,
						status: 500,
					});
				}
				const swap = `${column}__swap`;
				const copy = options?.copy ?? q(column);
				this.beforeTableAlter(table);
				const indexes = indexesOn(table, column);
				for (const index of indexes) sql.exec(`DROP INDEX ${q(index.name)};`);
				// A definition can name its own column (`CHECK (json_valid("tags"))`);
				// on the swap column that must name the swap column, or the CHECK
				// would point at the column about to be dropped. The final RENAME
				// rewrites it back.
				const swap_definition = definition.replace(
					new RegExp(`"${column}"`, 'g'),
					q(swap),
				);
				sql.exec(
					`ALTER TABLE ${q(table)} ADD COLUMN ${q(swap)} ${addableColumnDefinition(swap_definition)};`,
				);
				try {
					sql.exec(`UPDATE ${q(table)} SET ${q(swap)} = ${copy};`);
				} catch (error) {
					throw new DelightError({
						message: `Copying '${table}.${column}' into its new definition (${definition}) failed: ${DelightError.from(error).message}. Backfill the rows that don't fit first.`,
						status: 500,
					});
				}
				sql.exec(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)};`);
				sql.exec(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(swap)} TO ${q(column)};`);
				for (const index of indexes) sql.exec(index.sql);
				this.afterTableAlter(table);
			},
			rebuildTable: (table, options) => {
				requireTable(table);
				const referenced_by = sql
					// Cloudflare's own `_cf_*` tables refuse PRAGMAs (SQLITE_AUTH)
					.exec(
						`SELECT name FROM sqlite_schema WHERE type = 'table' AND name != ? AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%';`,
						table,
					)
					.toArray()
					.map((row) => String(row.name))
					.filter((other) =>
						sql
							.exec(`PRAGMA foreign_key_list(${q(other)});`)
							.toArray()
							.some((fk) => String(fk.table) === table),
					);
				if (referenced_by.length) {
					throw new DelightError({
						message: `rebuildTable('${table}') refused: ${referenced_by.join(', ')} reference it by foreign key, and dropping the old table would cascade into their rows. Change it column by column with alterColumn()/dropColumn() instead.`,
						status: 500,
						code: 'rebuild_referenced_table',
					});
				}
				const definition = options?.definition ?? this.declaredTable(table);
				if (!definition || !Object.keys(definition).length) {
					throw new DelightError({
						message: `rebuildTable('${table}') needs a definition: the table is not in the declared schema.`,
						status: 500,
					});
				}
				for (const column of Object.keys(definition)) assertIdentifier(column, 'column');
				const live = new Set(columns(table).map((c) => c.name));
				const target = `${table}__rebuild`;
				this.beforeTableAlter(table);
				const indexes = indexesOn(table);
				sql.exec(
					`CREATE TABLE ${q(target)} (${Object.entries(definition)
						.map(([column, def]) => `${q(column)} ${def}`)
						.join(', ')});`,
				);
				// A new column with a DEFAULT and nothing to copy is left out of
				// the INSERT so the default applies (an explicit NULL would skip
				// it and break a `NOT NULL DEFAULT`).
				const copied = Object.keys(definition).filter(
					(column) =>
						!!options?.copy?.[column] ||
						live.has(column) ||
						!/\bDEFAULT\b/i.test(definition[column]),
				);
				const select = copied.map((column) => {
					const copy = options?.copy?.[column];
					if (copy) return copy;
					if (live.has(column)) return q(column);
					const def = definition[column];
					// A new NOT NULL column with nothing to copy gets the type's zero
					if (/\bNOT\s+NULL\b/i.test(def)) {
						return /INTEGER|REAL|NUMERIC|BOOLEAN/i.test(def) ? '0' : "''";
					}
					return 'NULL';
				});
				sql.exec(
					`INSERT INTO ${q(target)} (${copied.map(q).join(', ')}) SELECT ${select.join(', ')} FROM ${q(table)};`,
				);
				sql.exec(`DROP TABLE ${q(table)};`);
				sql.exec(`ALTER TABLE ${q(target)} RENAME TO ${q(table)};`);
				// Indexes whose columns survived come back; the rest are gone with
				// the columns (a declared schema re-creates its own on boot).
				const kept = new Set(columns(table).map((c) => c.name));
				for (const index of indexes) {
					const covered = index.sql.match(/\(([^)]*)\)/)?.[1] ?? '';
					const names = [...covered.matchAll(/"?([A-Za-z_][A-Za-z0-9_$]*)"?/g)]
						.map((m) => m[1])
						.filter((name) => !/^(ASC|DESC|COLLATE|NOCASE)$/i.test(name));
					if (names.every((name) => kept.has(name))) sql.exec(index.sql);
				}
				const violations = sql.exec(`PRAGMA foreign_key_check(${q(table)});`).toArray();
				if (violations.length) {
					throw new DelightError({
						message: `rebuildTable('${table}') would leave ${violations.length} row(s) violating a foreign key.`,
						status: 500,
					});
				}
				this.afterTableAlter(table);
			},
		};
		return context;
	}
}

/** Double-quote a SQL identifier. */
function quoteIdentifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

function assertIdentifier(name: string, kind: 'table' | 'column'): void {
	if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
		throw new DelightError({
			message: `Invalid ${kind} name '${String(name)}'.`,
			status: 500,
		});
	}
}

function isUniqueColumn(sql: SqlStorage, table: string, column: string): boolean {
	for (const index of sql
		.exec(`PRAGMA index_list(${quoteIdentifier(table)});`)
		.toArray()) {
		if (Number(index.unique) !== 1 || String(index.origin) === 'pk') continue;
		const covered = sql
			.exec(`PRAGMA index_info(${quoteIdentifier(String(index.name))});`)
			.toArray()
			.map((info) => String(info.name));
		if (covered.length === 1 && covered[0] === column) return true;
	}
	return false;
}

/**
 * A column definition `ALTER TABLE ADD COLUMN` will accept.
 *
 * SQLite refuses to ADD a NOT NULL column to a table with rows unless the
 * column carries a DEFAULT, so one is supplied: the type's zero value. Entity
 * reads go through parse(), which applies the schema's real default anyway;
 * this only satisfies SQLite for existing rows.
 */
export function addableColumnDefinition(definition: string): string {
	if (/NOT NULL/i.test(definition) && !/DEFAULT/i.test(definition)) {
		// BOOLEAN included: the zero of a 0/1 column is 0, not ''.
		const zero = /INTEGER|REAL|NUMERIC|BOOLEAN/i.test(definition) ? '0' : "''";
		return `${definition} DEFAULT ${zero}`;
	}
	return definition;
}
