/**
 * D1 in workerd: declared indexes, `execMany`, `explainSql`, typed `exec`.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Database } from '../schema/schema.js';
import { DatabaseServer } from '../server/db.server.js';
import { TABLES, measure } from './fixtures.js';
import type { BareDatabase, TestDatabase } from './worker.js';

function stub(name: string) {
	return env.DB.get(env.DB.idFromName(name));
}

function indexSql(ctx: DurableObjectState, name: string): string | undefined {
	const row = ctx.storage.sql
		.exec(`SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?`, name)
		.toArray()[0];
	return row ? String(row.sql) : undefined;
}

const eventTable = (indexes: Database.TableIndex<string>[]) =>
	Database.table(
		'event',
		(s) => ({
			document_id: s.string(),
			kind: s.enum(['opened', 'signed', 'voided']),
			dispatched_at: s.number().optional(),
			code: s.string().optional(),
		}),
		{ indexes: indexes as never },
	);

describe('declared indexes', () => {
	it('creates multi-column, enum, partial and unique indexes', async () => {
		await runInDurableObject(stub('idx-create'), (db: TestDatabase) => {
			const table = eventTable([
				{
					columns: [
						'document_id',
						{ column: 'created_at', direction: 'DESC' },
						{ column: 'id', direction: 'DESC' },
					],
				},
				{ columns: ['kind'] },
				{
					name: 'idx_event_pending',
					columns: ['created_at'],
					where: 'dispatched_at IS NULL',
				},
				{ columns: ['code'], unique: true, where: 'code IS NOT NULL' },
			]);
			const server = new DatabaseServer({ event: table }, () => undefined, db.state, {
				DEV: true,
			} as never);
			expect(indexSql(db.state, 'idx_event_document_id_created_at_id')).toMatch(
				/\("document_id" ASC, "created_at" DESC, "id" DESC\)$/,
			);
			expect(indexSql(db.state, 'idx_event_kind')).toBeDefined();
			expect(indexSql(db.state, 'idx_event_pending')).toMatch(
				/WHERE dispatched_at IS NULL$/,
			);
			expect(indexSql(db.state, 'idx_event_code')).toMatch(/^CREATE UNIQUE INDEX/);

			server.create('event', { document_id: 'd1', kind: 'opened', code: 'A' });
			expect(() =>
				server.create('event', { document_id: 'd2', kind: 'opened', code: 'A' }),
			).toThrow(/UNIQUE/);
			// Partial: rows outside the condition don't collide
			server.create('event', { document_id: 'd3', kind: 'opened' });
			server.create('event', { document_id: 'd4', kind: 'opened' });

			// The planner uses the multi-column index for the chain-head lookup
			const plan = db.state.storage.sql
				.exec(
					`EXPLAIN QUERY PLAN SELECT id FROM event WHERE document_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
					'd1',
				)
				.toArray()
				.map((row) => String(row.detail))
				.join(' | ');
			expect(plan).toContain('idx_event_document_id_created_at_id');
			expect(plan).not.toContain('TEMP B-TREE');
		});
	});

	it('recreates an index whose definition changed and drops a removed one', async () => {
		await runInDurableObject(stub('idx-change'), (db: TestDatabase) => {
			new DatabaseServer(
				{ event: eventTable([{ columns: ['kind'] }, { columns: ['document_id'] }]) },
				() => undefined,
				db.state,
				{ DEV: true } as never,
			);
			expect(indexSql(db.state, 'idx_event_kind')).not.toMatch(/WHERE/);
			// Redeploy: kind becomes partial, document_id is gone
			new DatabaseServer(
				{ event: eventTable([{ columns: ['kind'], where: "kind != 'voided'" }]) },
				() => undefined,
				db.state,
				{ DEV: true } as never,
			);
			expect(indexSql(db.state, 'idx_event_kind')).toMatch(/WHERE kind != 'voided'$/);
			expect(indexSql(db.state, 'idx_event_document_id')).toBeUndefined();
		});
	});

	it('rejects a column the table does not have at definition time', () => {
		expect(() => eventTable([{ columns: ['nope'] }])).toThrow(/does not have/);
	});
});

describe('execMany', () => {
	it('answers several reads in one call, from one snapshot', async () => {
		await runInDurableObject(stub('exec-many'), (db: TestDatabase) => {
			const deal = db.create('deal', {
				address: '1 Main',
				city: 'Wichita',
				state: 'KS',
				postal_code: '67202',
				kind: 'purchase',
				status: 'draft',
			});
			db.create('participant', { deal_id: deal.id, name: 'Ann', role: 'buyer' });
			db.create('participant', { deal_id: deal.id, name: 'Bo', role: 'seller' });
			type DealRow = Database.Row<typeof TABLES.deal>;
			type ParticipantRow = Database.Row<typeof TABLES.participant>;
			const [deals, participants, count] = db.execMany<
				[Pick<DealRow, 'id' | 'city'>, Pick<ParticipantRow, 'name'>, { n: number }]
			>([
				['SELECT id, city FROM deal WHERE id = ?', deal.id],
				['SELECT name FROM participant WHERE deal_id = ? ORDER BY name', deal.id],
				['SELECT COUNT(*) AS n FROM participant'],
			]);
			expectTypeOf(deals[0].city).toEqualTypeOf<string>();
			expect(deals).toEqual([{ id: deal.id, city: 'Wichita' }]);
			expect(participants.map((p) => p.name)).toEqual(['Ann', 'Bo']);
			expect(count[0].n).toBe(2);
		});
	});

	it('refuses writes, including a write dressed as a read', async () => {
		await runInDurableObject(stub('exec-many-write'), (db: TestDatabase) => {
			db.exec(`CREATE TABLE scratch (v INTEGER)`);
			expect(() => db.execMany([['INSERT INTO scratch VALUES (1)']])).toThrow(
				/read-only/,
			);
			expect(() =>
				db.execMany([
					['SELECT 1'],
					['WITH x AS (SELECT 1) INSERT INTO scratch SELECT * FROM x'],
				]),
			).toThrow(/wrote 1 row/);
			// Rolled back
			expect(db.exec(`SELECT COUNT(*) AS n FROM scratch`)[0].n).toBe(0);
		});
	});

	it('is one round trip over RPC', async () => {
		const db = stub('exec-many-rpc');
		const results = await db.execMany([['SELECT 1 AS a'], ['SELECT 2 AS b']]);
		expect(results).toEqual([[{ a: 1 }], [{ b: 2 }]]);
	});
});

describe('explainSql', () => {
	it('passes a valid statement with unbound parameters', async () => {
		await runInDurableObject(stub('explain-ok'), (db: TestDatabase) => {
			expect(() =>
				db.explainSql(
					`SELECT d.id, p.name FROM deal d JOIN participant p ON p.deal_id = d.id WHERE d.id = ?1 AND p.role = ?2 AND p.name LIKE ?`,
				),
			).not.toThrow();
		});
	});

	it('names an unknown column or table', async () => {
		await runInDurableObject(stub('explain-bad'), (db: TestDatabase) => {
			expect(() => db.explainSql(`SELECT adress FROM deal`)).toThrow(
				/no such column: adress/,
			);
			expect(() => db.explainSql(`SELECT * FROM deals`)).toThrow(/no such table: deals/);
		});
	});

	it('writes nothing', async () => {
		await runInDurableObject(stub('explain-cost'), (db: TestDatabase) => {
			const cost = measure(db.state, () => db.explainSql(`DELETE FROM deal`));
			expect(cost.written).toBe(0);
			expect(db.exec(`SELECT COUNT(*) AS n FROM deal`)[0].n).toBe(0);
		});
	});
});

describe('Database.Row', () => {
	it('is the storage shape', () => {
		type DealRow = Database.Row<typeof TABLES.deal>;
		expectTypeOf<DealRow['private']>().toEqualTypeOf<0 | 1 | null>();
		expectTypeOf<DealRow['tags']>().toEqualTypeOf<string | null>();
		expectTypeOf<DealRow['kind']>().toEqualTypeOf<'purchase' | 'listing' | 'lease'>();
		expectTypeOf<DealRow['price_cents']>().toEqualTypeOf<number | null>();
		expectTypeOf<DealRow['id']>().toEqualTypeOf<string>();
		expectTypeOf<DealRow['created_at']>().toEqualTypeOf<number>();
	});
});

describe('schemaSql', () => {
	it('runs as-is and matches what the server creates', async () => {
		const { schemaSql } = await import('../server/schema.sql.js');
		const text = schemaSql(TABLES);
		const statements = text
			.split(/;\n/)
			.map((statement) => statement.replace(/^(--[^\n]*\n)+/g, '').trim())
			.filter(Boolean)
			.map((statement) => `${statement};`);
		// Valid SQL against an empty database (the delete trigger names the
		// search tables, which a DatabaseServer creates alongside)
		await runInDurableObject(
			env.BARE.get(env.BARE.idFromName(`schema-${crypto.randomUUID()}`)),
			(bare: BareDatabase) => {
				const sql = bare.state.storage.sql;
				sql.exec(`CREATE TABLE _changes (seq INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, op TEXT NOT NULL, before TEXT)`);
				for (const statement of statements) sql.exec(statement);
			},
		);
		// Every trigger and index it lists is exactly what the server built
		await runInDurableObject(stub(`schema-live-${crypto.randomUUID()}`), (db: TestDatabase) => {
			const live = new Map(
				db.state.storage.sql
					.exec(`SELECT name, sql FROM sqlite_schema WHERE type IN ('trigger', 'index') AND sql IS NOT NULL`)
					.toArray()
					.map((row) => [String(row.name), String(row.sql).replace(/\s+/g, ' ').replace(/;$/, '')]),
			);
			for (const statement of statements) {
				const match = /^CREATE (?:UNIQUE )?(?:INDEX|TRIGGER) "([^"]+)"/.exec(statement);
				if (!match) continue;
				expect(live.get(match[1]), match[1]).toBe(
					statement.replace(/\s+/g, ' ').replace(/;$/, '').replace(/ IF NOT EXISTS/, ''),
				);
			}
		});
	});
});
