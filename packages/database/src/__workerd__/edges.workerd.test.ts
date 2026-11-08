/**
 * Edge cases found in review, each reproduced here first and then fixed:
 * the read-only guards, migrations shipped alongside the upgrade from 2.5.1,
 * history for raw writes, capture opt-out, the drain cap, no-op updates.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Database } from '../schema/schema.js';
import { DatabaseServer } from '../server/db.server.js';
import type { Migration } from '../server/sql.database.js';
import { measure, TABLES } from './fixtures.js';
import type { BareDatabase, TestDatabase } from './worker.js';

function dbStub() {
	return env.DB.get(env.DB.idFromName(`edges-${crypto.randomUUID()}`));
}
function bareStub() {
	return env.BARE.get(env.BARE.idFromName(`edges-bare-${crypto.randomUUID()}`));
}

function boot(
	db: BareDatabase,
	tables: Record<string, Database.Table>,
	migrations?: Migration[],
): DatabaseServer<Record<string, Database.Table>> {
	return new DatabaseServer(tables, () => undefined, db.state, { DEV: true } as never, {
		migrations,
	}) as DatabaseServer<Record<string, Database.Table>>;
}

function open(db: TestDatabase) {
	return new DatabaseServer(TABLES, () => undefined, db.state, { DEV: true } as never);
}

function seedDeal(server: DatabaseServer<typeof TABLES>) {
	return server.create('deal', {
		address: '1234 Elm Street',
		city: 'Wichita',
		state: 'KS',
		postal_code: '67202',
		kind: 'purchase',
		status: 'draft',
	});
}

/** Put a table back into its 2.5.1 shape: no `_w` column, no change triggers. */
function stripWriteMarker(db: BareDatabase | TestDatabase, table: string) {
	const sql = db.state.storage.sql;
	for (const suffix of ['ins', 'upd', 'del']) {
		sql.exec(`DROP TRIGGER IF EXISTS "_chg_${table}_${suffix}"`);
	}
	sql.exec(`ALTER TABLE "${table}" DROP COLUMN "_w"`);
}

describe('execMany read-only guard', () => {
	it('refuses a write hidden behind a read in one multi-statement string', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const deal = seedDeal(server);
			let threw = false;
			try {
				server.execMany([['SELECT 1; DELETE FROM deal']]);
			} catch {
				threw = true;
			}
			const rows = db.state.storage.sql.exec(`SELECT COUNT(*) AS n FROM deal`).one().n;
			expect({ threw, rows_left: rows }).toEqual({ threw: true, rows_left: 1 });
			expect(() => server.get('deal', deal.id)).not.toThrow();
		});
	});

	it('refuses DDL hidden behind a read', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			seedDeal(server);
			let threw = false;
			try {
				server.execMany([['SELECT 1; DROP TABLE person']]);
			} catch {
				threw = true;
			}
			const exists = !db.state.storage.sql
				.exec(`SELECT 1 FROM sqlite_schema WHERE type='table' AND name='person'`)
				.next().done;
			expect({ threw, person_table_exists: exists }).toEqual({
				threw: true,
				person_table_exists: true,
			});
		});
	});

	it('does not let a PRAGMA change connection state for later queries', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const before = db.state.storage.sql.exec(`SELECT 'ABC' LIKE 'abc' AS m`).one().m;
			let error: string | undefined;
			try {
				server.execMany([['PRAGMA case_sensitive_like = 1']]);
			} catch (e) {
				error = String((e as Error).message ?? e);
			}
			const after = db.state.storage.sql.exec(`SELECT 'ABC' LIKE 'abc' AS m`).one().m;
			// Either the PRAGMA is refused, or it must not have changed LIKE semantics
			expect({ error: error ? 'refused' : 'allowed', before, after }).toEqual({
				error: error ? 'refused' : 'allowed',
				before: 1,
				after: 1,
			});
		});
	});
});

describe('explainSql', () => {
	it('never runs a statement, even a second one after a semicolon', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			seedDeal(server);
			try {
				server.explainSql(`SELECT 1; DELETE FROM deal`);
			} catch {
				// a 400 is fine; a deleted row is not
			}
			const rows = db.state.storage.sql.exec(`SELECT COUNT(*) AS n FROM deal`).one().n;
			expect(rows).toBe(1);
		});
	});
});

describe('rebuildTable on a table still in the 2.5.1 shape', () => {
	it('fills a new NOT NULL DEFAULT column (such as _w) from its default', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const person = Database.table('person', (s) => ({
				name: s.string().searchable(),
				email: s.string().optional(),
			}));
			const v1 = boot(db, { person });
			v1.create('person', { name: 'Ann' });
			// A 2.5.1 database has no `_w`; the first wake of the new version adds
			// it in the additive pass — which runs AFTER migrations.
			stripWriteMarker(db, 'person');
			const v2 = boot(db, { person }, [
				{ id: '0001_rebuild', up: (m) => m.rebuildTable('person') },
			]);
			const status = v2.migrationStatus();
			expect(status.failed).toEqual([]);
			expect(status.applied).toEqual(['0001_rebuild']);
			expect(v2.list('person', {} as never).hits).toHaveLength(1);
		});
	});
});

describe('a preflight migration shipped with the upgrade from 2.5.1', () => {
	it('must not leave the tenant unable to write', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const person = Database.table('person', (s) => ({
				name: s.string().searchable(),
			}));
			const v1 = boot(db, { person });
			v1.create('person', { name: 'Ann' });
			stripWriteMarker(db, 'person');
			// The upgrade deploy also ships a preflight migration (to be dry-run
			// with checkMigrations() first). Pending → the additive pass is held
			// back → `_w` is never added.
			const v2 = boot(db, { person }, [
				{ id: '0001_preflight', preflight: true, up: () => {} },
			]);
			let error: string | undefined;
			try {
				v2.create('person', { name: 'Bo' });
			} catch (e) {
				error = String((e as Error).message ?? e);
			}
			expect(error).toBeUndefined();
		});
	});
});

describe('a state row without tables', () => {
	it('is treated as fresh, so declared migrations do not block table creation forever', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			// A 2.5.1 constructor that threw after writing its state row and before
			// creating any table (or a tenant whose tables were dropped by hand).
			const sql = db.state.storage.sql;
			sql.exec(
				`CREATE TABLE state (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
			);
			sql.exec(
				`INSERT INTO state VALUES ('main', ?, ?, ?)`,
				JSON.stringify({ meta: {}, sql_indexes: [], table_config: {} }),
				Date.now(),
				Date.now(),
			);
			const person = Database.table('person', (s) => ({ name: s.string().searchable() }));
			const server = boot(db, { person }, [
				{ id: '0001_touch', up: (m) => m.exec(`UPDATE person SET name = name`) },
			]);
			const report = server.schemaReport();
			expect(report.drift.filter((d) => d.kind === 'missing_table')).toEqual([]);
			expect(report.migrations.failed).toEqual([]);
		});
	});
});

describe('history for raw writes', () => {
	it('a raw insert then raw delete inside one drain window leaves a trace', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const deal = seedDeal(server);
			const sql = db.state.storage.sql;
			const now = Date.now();
			sql.exec(
				`INSERT INTO document (id, deal_id, name, status, field_values, created_at, updated_at) VALUES ('doc_x', ?, 'Lease', 'draft', '{}', ?, ?)`,
				deal.id,
				now,
				now,
			);
			sql.exec(`DELETE FROM document WHERE id = 'doc_x'`);
			server.drainChanges();
			const entries = server.history('document', 'doc_x');
			// The row existed: history should hold its create and its delete (with
			// the before image the delete trigger captured).
			expect(entries.map((e) => e.operation)).toEqual(['delete', 'create']);
		});
	});

	it('an exec op and a library update of the same row in one transaction do not double-record', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const deal = seedDeal(server);
			const doc = server.create('document', {
				deal_id: deal.id,
				name: 'Lease',
				status: 'draft',
				field_values: '{}',
			});
			server.transaction([
				{
					exec: {
						statement: `UPDATE document SET name = 'Lease v2' WHERE id = ?`,
						bindings: [doc.id],
					},
				},
				{ update: { type: 'document', id: doc.id, data: { status: 'sent' } } },
			]);
			const entries = server.history('document', doc.id);
			const status_changes = entries.filter(
				(e) => e.operation === 'update' && e.patch && 'status' in (e.patch as object),
			);
			// The raw rename and the library status change each recorded once,
			// in order (newest first).
			expect(entries.map((e) => [e.operation, e.patch])).toEqual([
				['update', { status: 'sent' }],
				['update', { name: 'Lease v2' }],
				['create', expect.anything()],
			]);
			expect(status_changes).toHaveLength(1);
			// And the search index reflects the raw rename
			const hits = (
				server.list('document', { term: 'v2' } as never) as { hits: { id: string }[] }
			).hits.map((h) => h.id);
			expect(hits).toEqual([doc.id]);
		});
	});
});

describe('alterColumn on a nullable foreign-key column', () => {
	it('works as the docs imply (only NOT NULL foreign keys are refused)', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const deal = Database.table('deal', (s) => ({ address: s.string().searchable() }));
			const participant = Database.table('participant', (s) => ({
				deal_id: s
					.foreignKey({ type: 'string', table: 'deal', column: 'id', on_delete: 'SET NULL' })
					.optional(),
				name: s.string().searchable(),
			}));
			const v1 = boot(db, { deal, participant });
			const d = v1.create('deal', { address: '1 Main' });
			v1.create('participant', { deal_id: d.id as string, name: 'Ann' });
			const v2 = boot(db, { deal, participant }, [
				{ id: '0001_swap_fk', up: (m) => m.alterColumn('participant', 'deal_id') },
			]);
			expect(v2.migrationStatus().failed).toEqual([]);
		});
	});
});

describe('capture_raw_writes: false', () => {
	it('leaves an internal ledger table without triggers, so a raw write costs only itself', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const job = Database.table(
				'job',
				(s) => ({ kind: s.string(), attempts: s.number().default(0) }),
				{ capture_raw_writes: false },
			);
			const note = Database.table('note', (s) => ({ body: s.string().searchable() }));
			const server = boot(db, { job, note });
			const sql = db.state.storage.sql;
			const triggers = sql
				.exec(`SELECT tbl_name FROM sqlite_schema WHERE type = 'trigger' AND name LIKE '_chg_%'`)
				.toArray()
				.map((row) => String(row.tbl_name));
			expect(new Set(triggers)).toEqual(new Set(['note']));
			const created = server.create('job', { kind: 'email' });
			const cost = measure(db.state, () => {
				sql.exec(`UPDATE job SET attempts = attempts + 1 WHERE id = ?`, created.id);
			});
			expect(cost.written).toBe(1);
			expect(sql.exec(`SELECT COUNT(*) AS n FROM _changes`).one().n).toBe(0);
			// Library writes to it still work as before.
			expect(server.update('job', created.id as string, { kind: 'sms' }).kind).toBe('sms');
		});
	});

	it('drops the triggers an earlier version created', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const captured = Database.table('job', (s) => ({ kind: s.string() }));
			boot(db, { job: captured });
			const opted_out = Database.table('job', (s) => ({ kind: s.string() }), {
				capture_raw_writes: false,
			});
			boot(db, { job: opted_out });
			expect(
				db.state.storage.sql
					.exec(`SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'trigger' AND name LIKE '_chg_job_%'`)
					.one().n,
			).toBe(0);
		});
	});
});

describe('automatic drain cap', () => {
	it('catches up at most 2,000 rows per request and leaves the rest to the alarm', async () => {
		await runInDurableObject(dbStub(), async (db: TestDatabase) => {
			const server = open(db);
			const sql = db.state.storage.sql;
			const now = Date.now();
			for (let i = 0; i < 2500; i++) {
				sql.exec(
					`INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
					`p${i}`,
					`Person ${i}`,
					now,
					now,
				);
			}
			const pending = () => Number(sql.exec(`SELECT COUNT(*) AS n FROM _changes`).one().n);
			expect(pending()).toBe(2500);
			server.get('person', 'p0');
			expect(pending()).toBe(500);
			await server.alarm();
			expect(pending()).toBe(0);
			expect(
				(server.list('person', {} as never) as { count: number }).count,
			).toBe(2500);
		});
	});

	it('drains everything when called directly', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const sql = db.state.storage.sql;
			for (let i = 0; i < 2100; i++) {
				sql.exec(`INSERT INTO person (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)`, `q${i}`, `Q ${i}`);
			}
			expect(server.drainChanges()).toBe(2100);
		});
	});
});

describe('updates that change nothing', () => {
	it('write no row, keep updated_at, record no history and broadcast nothing', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const deal = seedDeal(server);
			const doc = server.create('document', { deal_id: deal.id, name: 'Lease', status: 'draft', field_values: '{}' });
			const cost = measure(db.state, () => {
				const result = server.update('document', doc.id, { status: 'draft', name: 'Lease' });
				expect(result.updated_at).toBe(doc.updated_at);
			});
			expect(cost.written).toBe(0);
			expect(server.history('document', doc.id).map((e) => e.operation)).toEqual(['create']);
			const [result] = server.transaction([
				{ update: { type: 'document', id: doc.id, data: { status: 'draft' } } },
			]);
			expect('entity' in result && result.entity.unchanged).toBe(true);
		});
	});
});

describe('the raw-write catch-up', () => {
	it('does not rewrite a row whose raw write already set a fresh updated_at', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const person = server.create('person', { name: 'Ann' });
			const sql = db.state.storage.sql;
			sql.exec(
				`UPDATE person SET name = 'Anne', updated_at = ? WHERE id = ?`,
				Date.now() + 60_000,
				person.id,
			);
			const statements: string[] = [];
			const original = sql.exec;
			(sql as { exec: unknown }).exec = (query: string, ...bindings: unknown[]) => {
				statements.push(query);
				return original.call(sql, query, ...(bindings as never[]));
			};
			try {
				server.drainChanges();
			} finally {
				(sql as { exec: unknown }).exec = original;
			}
			expect(statements.some((q) => /^UPDATE "person"/.test(q))).toBe(false);
			expect(server.get('person', person.id as string)!.name).toBe('Anne');
		});
	});
});

describe('execMany on a DatabaseServer', () => {
	it('catches up pending raw writes before reading', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const person = server.create('person', { name: 'Ann' });
			db.state.storage.sql.exec(`UPDATE person SET name = 'Anne' WHERE id = ?`, person.id);
			const [[row]] = server.execMany([
				['SELECT updated_at FROM person WHERE id = ?', person.id],
			]);
			expect(Number(row.updated_at)).toBeGreaterThan(Number(person.updated_at));
		});
	});
});

describe('transaction()', () => {
	it('rejects an operation of unknown shape instead of skipping it', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			expect(() =>
				server.transaction([{ type: 'create', entity_type: 'person', data: { name: 'A' } } as never]),
			).toThrow(/Unknown transaction operation/);
		});
	});
});

describe('JSON column move on the upgrade wake', () => {
	it('finishes before the first request when the database is small', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const deal = seedDeal(server);
			const sql = db.state.storage.sql;
			for (let i = 0; i < 1500; i++) {
				server.create('document', {
					deal_id: deal.id,
					name: `Doc ${i}`,
					status: 'draft',
					field_values: '{}',
					field_schema: [{ id: `f${i}`, type: 'text', page: 1, x: 0, y: 0 }],
				});
			}
			// Back to the 2.5.1 layout: the array lives in the blob.
			sql.exec(
				`UPDATE document SET "json" = json_set(IFNULL("json", '{}'), '$.field_schema', json(field_schema)), field_schema = NULL, _w = 1 - _w`,
			);
			const state = JSON.parse(String(sql.exec(`SELECT json FROM state WHERE id = 'main'`).one().json));
			delete state.json_columns_moved;
			sql.exec(`UPDATE state SET json = ? WHERE id = 'main'`, JSON.stringify(state));
			open(db);
			expect(
				sql.exec(`SELECT COUNT(*) AS n FROM document WHERE field_schema IS NULL`).one().n,
			).toBe(0);
		});
	});
});
