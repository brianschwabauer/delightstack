/**
 * Edge cases from the second review round (of the first round's fixes):
 * fresh-database detection across a table rename, the held-back schema pass
 * and a JSON field rename, EXPLAIN-wrapped PRAGMAs, a drain inside a
 * rolled-back transaction, and a deduplicated no-op update.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Database } from '../schema/schema.js';
import { DatabaseServer } from '../server/db.server.js';
import type { Migration } from '../server/sql.database.js';
import { TABLES } from './fixtures.js';
import type { BareDatabase, TestDatabase } from './worker.js';

function dbStub() {
	return env.DB.get(env.DB.idFromName(`edges2-${crypto.randomUUID()}`));
}
function bareStub() {
	return env.BARE.get(env.BARE.idFromName(`edges2-bare-${crypto.randomUUID()}`));
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

describe('fresh detection', () => {
	it('an existing database whose only table a migration renames is not fresh', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const person = Database.table('person', (s) => ({ name: s.string().searchable() }));
			const v1 = boot(db, { person });
			v1.create('person', { name: 'Ann' });

			// v2 declares the table under a new name and ships the rename.
			const contact = Database.table('contact', (s) => ({
				name: s.string().searchable(),
			}));
			const v2 = boot(db, { contact }, [
				{
					id: '0001_rename_person',
					up: (m) => m.exec(`ALTER TABLE person RENAME TO contact`),
				},
			]);
			const report = v2.schemaReport();
			const names = (v2.list('contact', { sparse: false } as never) as { hits: any[] }).hits.map((hit: any) => hit.document?.name);
			const stranded = db.state.storage.sql
				.exec(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'person'`)
				.toArray().length;
			expect({ failed: report.migrations.failed, names, stranded }).toEqual({
				failed: [],
				names: ['Ann'],
				stranded: 0,
			});
		});
	});
});

describe('held-back additive pass', () => {
	it('does not pre-create a JSON column a pending migration is about to rename into', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const v1_doc = Database.table('doc', (s) => ({
				title: s.string().searchable(),
				tags: s.array(s.string()).optional(),
			}));
			const v1 = boot(db, { doc: v1_doc });
			v1.create('doc', { title: 'A', tags: ['x'] });

			// v2 renames the JSON field `tags` -> `labels`, shipped as preflight
			// first (pending by design), then flipped to a real migration.
			const v2_doc = Database.table('doc', (s) => ({
				title: s.string().searchable(),
				labels: s.array(s.string()).optional(),
			}));
			const rename: Migration = {
				id: '0001_rename_tags',
				up: (m) => m.exec(`ALTER TABLE doc RENAME COLUMN tags TO labels`),
			};
			boot(db, { doc: v2_doc }, [{ ...rename, preflight: true }]);
			const live = db.state.storage.sql
				.exec(`PRAGMA table_info(doc)`)
				.toArray()
				.map((r) => r.name);
			const v3 = boot(db, { doc: v2_doc }, [rename]);
			const report = v3.schemaReport();
			expect({
				live_has_labels: live.includes('labels'),
				failed: report.migrations.failed,
			}).toEqual({
				live_has_labels: false,
				failed: [],
			});
		});
	});
});

describe('read-only guards', () => {
	it('EXPLAIN does not smuggle a connection-state PRAGMA through execMany', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const sql = db.state.storage.sql;
			const before = sql.exec(`SELECT 'ABC' LIKE 'abc' AS m`).one().m;
			let refused = false;
			try {
				server.execMany([['EXPLAIN PRAGMA case_sensitive_like = 1']]);
			} catch {
				refused = true;
			}
			const after = sql.exec(`SELECT 'ABC' LIKE 'abc' AS m`).one().m;
			expect({ before, after, refused_or_harmless: refused || after === before }).toEqual(
				{
					before: 1,
					after: 1,
					refused_or_harmless: true,
				},
			);
		});
	});

	it('explainSql does not apply a PRAGMA at prepare time', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const sql = db.state.storage.sql;
			try {
				server.explainSql(`PRAGMA case_sensitive_like = 1`);
			} catch {
				// a refusal is fine
			}
			const after = sql.exec(`SELECT 'ABC' LIKE 'abc' AS m`).one().m;
			expect(after).toBe(1);
		});
	});
});

describe('drain inside a rolled-back transaction', () => {
	it('leaves search consistent after an exec op is drained and the transaction fails', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const deal = server.create('deal', {
				address: '1234 Elm Street',
				city: 'Wichita',
				state: 'KS',
				postal_code: '67202',
				kind: 'purchase',
				status: 'draft',
			});
			let threw = false;
			try {
				server.transaction([
					{
						exec: {
							statement: `UPDATE deal SET address = ? WHERE id = ?`,
							bindings: ['99 Zebra Avenue', deal.id],
						},
					},
					// A bad op after the drain forces the rollback.
					{ update: { type: 'deal', id: 'missing-id', data: { notes: 'x' } } },
				]);
			} catch {
				threw = true;
			}
			expect(threw).toBe(true);
			const row = server.get('deal', deal.id);
			const zebra = (server.list('deal', { term: 'Zebra' } as never) as { hits: { id: string }[] }).hits.map((r) => r.id);
			const elm = (server.list('deal', { term: 'Elm' } as never) as { hits: { id: string }[] }).hits.map((r) => r.id);
			const pending = db.state.storage.sql
				.exec(`SELECT COUNT(*) AS n FROM _changes`)
				.one().n;
			expect({ address: row?.address, zebra, elm, pending }).toEqual({
				address: '1234 Elm Street',
				zebra: [],
				elm: [deal.id],
				pending: 0,
			});
		});
	});
});

describe('no-op update', () => {
	it('with an op_id records the dedupe row and replays the same row', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			const deal = server.create('deal', {
				address: '1234 Elm Street',
				city: 'Wichita',
				state: 'KS',
				postal_code: '67202',
				kind: 'purchase',
				status: 'draft',
			});
			const first = server.update(
				'deal',
				deal.id,
				{ status: 'draft' },
				{ op_id: 'op-1' },
			);
			const second = server.update(
				'deal',
				deal.id,
				{ status: 'draft' },
				{ op_id: 'op-1' },
			);
			expect(first.updated_at).toBe(deal.updated_at);
			expect(second.status).toBe('draft');
			expect(server.appliedOperation('op-1')?.kind).toBe('update');
		});
	});
});

describe('JSON column move of odd legacy values', () => {
	it('moves a bare string held in the blob without failing the column CHECK', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const doc = Database.table('doc', (s) => ({
				title: s.string().searchable(),
				meta: s.object({ note: s.string() }).optional(),
			}));
			const v1 = boot(db, { doc });
			const row = v1.create('doc', { title: 'A' });
			const sql = db.state.storage.sql;
			// Legacy data a v2 schema would never have written: a scalar.
			sql.exec(
				`UPDATE doc SET "json" = json_object('meta', 'just text'), _w = 1 - _w WHERE id = ?`,
				row.id,
			);
			const state = JSON.parse(String(sql.exec(`SELECT json FROM state WHERE id = 'main'`).one().json));
			delete state.json_columns_moved;
			sql.exec(`UPDATE state SET json = ? WHERE id = 'main'`, JSON.stringify(state));
			const v2 = boot(db, { doc });
			expect(v2.schemaReport().json_columns_pending).toEqual([]);
			expect(sql.exec(`SELECT meta FROM doc WHERE id = ?`, row.id).one().meta).toBe('"just text"');
		});
	});
});

describe('file GC for a run of raw writes', () => {
	it('queues every object the row pointed at during the run, not only the first and last', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const asset = Database.table('asset', (s) => ({
				name: s.string().searchable(),
				file: s.file({ store: 'FILES' }).optional(),
			}));
			const server = boot(db, { asset });
			const ref = (key: string) => JSON.stringify({ key, size: 1, mime: 'text/plain' });
			const sql = db.state.storage.sql;
			// insert A -> update to B -> update to C, all before one drain.
			sql.exec(
				`INSERT INTO asset (id, name, file, created_at, updated_at) VALUES ('a1', 'x', ?, 0, 0)`,
				ref('A'),
			);
			sql.exec(`UPDATE asset SET file = ? WHERE id = 'a1'`, ref('B'));
			sql.exec(`UPDATE asset SET file = ? WHERE id = 'a1'`, ref('C'));
			server.drainChanges();
			const queued = () =>
				sql
					.exec(`SELECT key FROM _file_gc ORDER BY key`)
					.toArray()
					.map((row) => String(row.key));
			expect(queued()).toEqual(['A', 'B']);
			sql.exec(`DELETE FROM asset WHERE id = 'a1'`);
			server.drainChanges();
			expect(queued()).toEqual(['A', 'B', 'C']);
		});
	});
});

describe('no-op updates on a table with derived fields', () => {
	it('write nothing', async () => {
		await runInDurableObject(bareStub(), (db: BareDatabase) => {
			const person = Database.table('person', (s) => ({
				first_name: s.string(),
				last_name: s.string(),
				full_name: s.string().derived((data) => `${data.first_name} ${data.last_name}`),
			}));
			const server = boot(db, { person });
			const row = server.create('person', { first_name: 'Ann', last_name: 'Lee' });
			const [result] = server.transaction([
				{ update: { type: 'person', id: row.id as string, data: { first_name: 'Ann' } } },
			]);
			expect('entity' in result && result.entity.unchanged).toBe(true);
		});
	});
});

describe('explainSql and comments', () => {
	it('sees a settings PRAGMA behind a leading comment', async () => {
		await runInDurableObject(dbStub(), (db: TestDatabase) => {
			const server = open(db);
			expect(() => server.explainSql('/* hi */ PRAGMA case_sensitive_like = 1')).toThrow();
			expect(() =>
				server.execMany([['EXPLAIN -- x\n PRAGMA case_sensitive_like = 1']]),
			).toThrow();
			expect(server.exec(`SELECT 'ABC' LIKE 'abc' AS same`)[0].same).toBe(1);
			// Introspection still works.
			expect(server.execMany([['PRAGMA table_info(deal)']])[0].length).toBeGreaterThan(0);
		});
	});
});
