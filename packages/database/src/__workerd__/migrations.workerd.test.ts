/**
 * D3 in workerd: numbered migrations, the column-swap and rebuild helpers,
 * non-bricking failures, schemaReport() and checkMigrations().
 *
 * Each test boots a DatabaseServer over the same storage twice — version 1 of
 * the schema, then version 2 with migrations — exactly what a deploy does to a
 * live tenant.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Database } from '../schema/schema.js';
import { DatabaseServer } from '../server/db.server.js';
import type { Migration } from '../server/sql.database.js';
import type { BareDatabase } from './worker.js';

function stub() {
	return env.BARE.get(env.BARE.idFromName(`migrate-${crypto.randomUUID()}`));
}

const dealV1 = Database.table('deal', (s) => ({
	address: s.string().searchable(),
	notes: s.string().optional(),
	status: s.enum(['draft', 'active']),
}));
const dealV2 = Database.table('deal', (s) => ({
	address: s.string().searchable().optional(),
	memo: s.string().optional(),
	status: s.enum(['draft', 'active']),
}));
const participant = Database.table('participant', (s) => ({
	deal_id: s.foreignKey({
		type: 'string',
		table: 'deal',
		column: 'id',
		on_delete: 'CASCADE',
	}),
	name: s.string().searchable(),
}));

function boot(
	db: BareDatabase,
	tables: Record<string, Database.Table>,
	migrations?: Migration[],
): DatabaseServer<Record<string, Database.Table>> {
	return new DatabaseServer(tables, () => undefined, db.state, { DEV: true } as never, {
		migrations,
	}) as DatabaseServer<Record<string, Database.Table>>;
}

function terms(server: DatabaseServer<Record<string, Database.Table>>, term: string) {
	return (server.list('deal', { term } as never) as { hits: { id: string }[] }).hits.map(
		(hit) => hit.id,
	);
}

describe('a brand-new database', () => {
	it('records every migration as applied without running any', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			let ran = 0;
			const server = boot(db, { deal: dealV2, participant }, [
				{ id: '0001', up: () => void ran++ },
				{ id: '0002', up: () => void ran++ },
			]);
			expect(ran).toBe(0);
			expect(server.migrationStatus()).toEqual({
				applied: ['0001', '0002'],
				pending: [],
				failed: [],
			});
		});
	});
});

describe('upgrading a live database', () => {
	it('relaxes NOT NULL and renames a column without touching child rows', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const v1 = boot(db, { deal: dealV1, participant });
			const deal = v1.create('deal', { address: '', notes: 'keep me', status: 'draft' });
			const other = v1.create('deal', { address: '9 Oak Street', status: 'active' });
			v1.create('participant', { deal_id: deal.id, name: 'Child Row' });

			const v2 = boot(db, { deal: dealV2, participant }, [
				{
					id: '0001_rename_notes',
					up: (m) => m.exec(`ALTER TABLE deal RENAME COLUMN notes TO memo`),
				},
				{
					id: '0002_relax_address',
					up: (m) => {
						m.alterColumn('deal', 'address');
						m.exec(`UPDATE deal SET address = NULL WHERE address = ''`);
					},
				},
			]);

			expect(v2.migrationStatus().applied).toEqual([
				'0001_rename_notes',
				'0002_relax_address',
			]);
			const upgraded = v2.get('deal', deal.id as string) as Record<string, unknown>;
			expect(upgraded.memo).toBe('keep me');
			expect(upgraded.address).toBeUndefined();
			// The child the old-style rebuild would have cascaded away
			expect(v2.exec(`SELECT COUNT(*) AS n FROM participant`)[0].n).toBe(1);
			// Nullable now, and nothing drifts from the declared schema
			v2.exec(
				`INSERT INTO deal (id, status, created_at, updated_at) VALUES ('n', 'draft', 1, 1)`,
			);
			expect(v2.schemaReport().drift).toEqual([]);
			// The data migration was caught up like any raw write
			expect(terms(v2, 'oak')).toEqual([other.id]);
			expect(v2.schemaReport().pending_changes).toBe(0);
			// Raw writes are still captured after the swap re-created the triggers
			v2.exec(`UPDATE deal SET address = '3 Elm Court' WHERE id = ?`, deal.id as string);
			expect(terms(v2, 'elm')).toEqual([deal.id]);
		});
	});

	it('rolls a failing migration back and keeps serving', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const v1 = boot(db, { deal: dealV1 });
			const deal = v1.create('deal', { address: '1 Main', status: 'draft' });
			const v2 = boot(db, { deal: dealV1 }, [
				{
					id: '0001_bad',
					up: (m) => {
						m.exec(`UPDATE deal SET notes = 'half done'`);
						m.exec(`SELECT * FROM no_such_table`);
					},
				},
				{ id: '0002_after', up: (m) => m.exec(`UPDATE deal SET notes = 'should wait'`) },
			]);
			const status = v2.migrationStatus();
			expect(status.applied).toEqual([]);
			expect(status.pending).toEqual(['0001_bad', '0002_after']);
			expect(status.failed[0]).toMatchObject({ id: '0001_bad' });
			expect(status.failed[0].error).toMatch(/no_such_table/);
			// Rolled back, and the database still answers
			expect((v2.get('deal', deal.id as string) as Record<string, unknown>).notes).toBeUndefined();
			// Fixed in the next deploy: applied on the next wake
			const v3 = boot(db, { deal: dealV1 }, [
				{ id: '0001_bad', up: (m) => m.exec(`UPDATE deal SET notes = 'fixed'`) },
				{ id: '0002_after', up: () => {} },
			]);
			expect(v3.migrationStatus()).toEqual({
				applied: ['0001_bad', '0002_after'],
				pending: [],
				failed: [],
			});
			expect((v3.get('deal', deal.id as string) as Record<string, unknown>).notes).toBe('fixed');
		});
	});

	it('a unique index the data violates is reported, not fatal', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const v1 = boot(db, { deal: dealV1 });
			v1.create('deal', { address: 'Same', status: 'draft' });
			v1.create('deal', { address: 'Same', status: 'draft' });
			const unique = Database.table(
				'deal',
				(s) => ({
					address: s.string().searchable(),
					notes: s.string().optional(),
					status: s.enum(['draft', 'active']),
				}),
				{ indexes: [{ columns: ['address'], unique: true }] },
			);
			// Used to throw out of the constructor and fail every request
			const v2 = boot(db, { deal: unique });
			expect(v2.list('deal', {} as never)).toMatchObject({ count: 2 });
			expect(v2.schemaReport().drift).toEqual([
				expect.objectContaining({
					kind: 'index_failed',
					index: 'idx_deal_address',
					live: expect.stringMatching(/UNIQUE/),
				}),
			]);
		});
	});
});

describe('rebuildTable', () => {
	it('refuses a table other tables reference, naming them', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			boot(db, { deal: dealV1, participant });
			const v2 = boot(db, { deal: dealV1, participant }, [
				{ id: '0001', up: (m) => m.rebuildTable('deal') },
			]);
			expect(v2.migrationStatus().failed[0].error).toMatch(/participant reference it/);
		});
	});

	it('rebuilds an unreferenced table, keeping rows and indexes', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const tagV1 = Database.table('tag', (s) => ({
				label: s.string().indexable(),
				code: s.string().optional(),
			}));
			const tagV2 = Database.table('tag', (s) => ({
				label: s.string().indexable(),
				code: s.string().unique().optional(),
			}));
			const v1 = boot(db, { tag: tagV1 });
			v1.create('tag', { label: 'hot', code: 'H' });
			const v2 = boot(db, { tag: tagV2 }, [
				{ id: '0001', up: (m) => m.rebuildTable('tag') },
			]);
			expect(v2.migrationStatus().applied).toEqual(['0001']);
			expect(v2.exec(`SELECT label, code FROM tag`)).toEqual([
				{ label: 'hot', code: 'H' },
			]);
			expect(() => v2.create('tag', { label: 'dup', code: 'H' })).toThrow(/UNIQUE/);
			expect(v2.schemaReport().drift).toEqual([]);
		});
	});
});

describe('schemaReport', () => {
	it('names each drift with the step that fixes it', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			boot(db, { deal: dealV1 });
			// v2's address is optional, and notes was removed — with no migration
			const report = boot(db, {
				deal: Database.table('deal', (s) => ({
					address: s.string().searchable().optional(),
					status: s.enum(['draft', 'active']),
				})),
			}).schemaReport();
			expect(report.drift).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: 'nullability',
						column: 'address',
						fix: "alterColumn('deal', 'address')",
					}),
					expect.objectContaining({
						kind: 'extra_column',
						column: 'notes',
						fix: "dropColumn('deal', 'notes')",
					}),
				]),
			);
		});
	});
});

describe('checkMigrations (preflight)', () => {
	it('dry-runs pending and preflight migrations against real data, keeping nothing', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const v1 = boot(db, { deal: dealV1 });
			const deal = v1.create('deal', { address: '1 Main', status: 'draft' });
			const v2 = boot(db, { deal: dealV1 }, [
				{
					id: '0001_backfill',
					preflight: true,
					up: (m) => m.exec(`UPDATE deal SET notes = 'backfilled'`),
				},
				{
					id: '0002_would_fail',
					preflight: true,
					up: (m) =>
						m.alterColumn('deal', 'notes', { definition: 'TEXT NOT NULL', copy: 'NULL' }),
				},
			]);
			// Not applied on wake
			expect(v2.migrationStatus().pending).toEqual(['0001_backfill', '0002_would_fail']);
			const checks = v2.checkMigrations();
			expect(checks[0]).toEqual({ id: '0001_backfill', ok: true });
			expect(checks[1]).toMatchObject({ id: '0002_would_fail', ok: false });
			expect(checks[1].error).toMatch(/NOT NULL/);
			// Nothing kept
			expect((v2.get('deal', deal.id as string) as Record<string, unknown>).notes).toBeUndefined();
			expect(v2.schemaReport().pending_changes).toBe(0);
		});
	});
});

describe('a migration the additive pass could get in the way of', () => {
	const rename: Migration = {
		id: '0001_rename_notes',
		up: (m) => m.exec(`ALTER TABLE deal RENAME COLUMN notes TO memo`),
	};

	it('a preflight rename dry-runs clean, then applies', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const v1 = boot(db, { deal: dealV1 });
			const deal = v1.create('deal', { address: '1 Main', notes: 'keep me', status: 'draft' });
			// Deploy 1: shipped as preflight. The schema pass must not add `memo`.
			const shipped = boot(db, { deal: dealV2 }, [{ ...rename, preflight: true }]);
			expect(shipped.checkMigrations()).toEqual([{ id: '0001_rename_notes', ok: true }]);
			// Deploy 2: the flag comes off
			const applied = boot(db, { deal: dealV2 }, [rename]);
			expect(applied.migrationStatus()).toEqual({
				applied: ['0001_rename_notes'],
				pending: [],
				failed: [],
			});
			expect((applied.get('deal', deal.id as string) as Record<string, unknown>).memo).toBe(
				'keep me',
			);
		});
	});

	it('a rename that failed once applies when retried', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const v1 = boot(db, { deal: dealV1 });
			const deal = v1.create('deal', { address: '1 Main', notes: 'keep me', status: 'draft' });
			const broken = boot(db, { deal: dealV2 }, [
				{
					id: '0001_rename_notes',
					up: (m) => {
						m.exec(`ALTER TABLE deal RENAME COLUMN notes TO memo`);
						throw new Error('transient');
					},
				},
			]);
			expect(broken.migrationStatus().failed).toHaveLength(1);
			// The schema pass waited, so the retry finds the old column
			const fixed = boot(db, { deal: dealV2 }, [rename]);
			expect(fixed.migrationStatus().applied).toEqual(['0001_rename_notes']);
			expect((fixed.get('deal', deal.id as string) as Record<string, unknown>).memo).toBe(
				'keep me',
			);
			// `memo` was not added a second time, and nothing else is missing
			expect(
				fixed.schemaReport().drift.filter((d) => d.kind !== 'nullability'),
			).toEqual([]);
		});
	});
});

describe('alterColumn on a column search indexes inside', () => {
	it('swaps a JSON column a generated search column reads', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const listingV1 = Database.table('listing', (s) => ({
				title: s.string(),
				address: s.object({ city: s.string().searchable() }),
			}));
			const v1 = boot(db, { listing: listingV1 });
			const row = v1.create('listing', { title: 'Farm', address: { city: 'Hays' } });
			const v2 = boot(db, { listing: listingV1 }, [
				{ id: '0001_swap', up: (m) => m.alterColumn('listing', 'address') },
			]);
			expect(v2.migrationStatus().applied).toEqual(['0001_swap']);
			const hits = (v2.list('listing', { where: { 'address.city': 'Hays' } } as never) as {
				hits: { id: string }[];
			}).hits.map((hit) => hit.id);
			expect(hits).toEqual([row.id]);
		});
	});
});
