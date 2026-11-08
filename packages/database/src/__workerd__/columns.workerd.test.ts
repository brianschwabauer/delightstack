/**
 * D4 in workerd: every JSON-typed field has a column of its own.
 *
 * Rows written before that change keep their objects and arrays in the shared
 * `json` overflow column; these tests put rows back into that legacy shape and
 * check that reads, search filters and the background move all handle it.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Database } from '../schema/schema.js';
import { DatabaseServer } from '../server/db.server.js';
import type { BareDatabase } from './worker.js';

function stub() {
	return env.BARE.get(env.BARE.idFromName(`columns-${crypto.randomUUID()}`));
}

const listing = Database.table('listing', (s) => ({
	title: s.string().searchable(),
	tags: s.array(s.string()).searchable().optional(),
	address: s.object({ city: s.string().searchable(), zip: s.string() }).optional(),
	layout: s.array(s.object({ id: s.string(), page: s.number() })).optional(),
}));
const TABLES = { listing };

function boot(db: BareDatabase) {
	return new DatabaseServer(TABLES, () => undefined, db.state, { DEV: true } as never);
}

/** Put every row back the way the previous layout stored it. */
function toLegacyLayout(db: BareDatabase) {
	const sql = db.state.storage.sql;
	sql.exec(
		`UPDATE listing SET "json" = json_set(IFNULL("json", '{}'),
			'$.tags', json(tags), '$.address', json(address), '$.layout', json(layout)),
			tags = NULL, address = NULL, layout = NULL, _w = 1 - _w`,
	);
	const state = JSON.parse(
		String(sql.exec(`SELECT json FROM state WHERE id = 'main'`).one().json),
	);
	delete state.json_columns_moved;
	sql.exec(`UPDATE state SET json = ? WHERE id = 'main'`, JSON.stringify(state));
}

function ids(server: DatabaseServer<typeof TABLES>, query: Record<string, unknown>) {
	return (server.list('listing', query as never) as { hits: { id: string }[] }).hits
		.map((hit) => hit.id)
		.sort();
}

describe('JSON columns', () => {
	it('stores objects and arrays as JSON text raw SQL can read', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = boot(db);
			const row = server.create('listing', {
				title: 'Farmhouse',
				tags: ['acreage', 'barn'],
				address: { city: 'Hays', zip: '67601' },
			});
			const [raw] = server.exec<Database.Row<typeof listing>>(
				`SELECT tags, address, json FROM listing WHERE id = ?`,
				row.id,
			);
			expect(JSON.parse(raw.tags!)).toEqual(['acreage', 'barn']);
			expect(JSON.parse(raw.address!)).toEqual({ city: 'Hays', zip: '67601' });
			expect(raw.json).toBe('{}');
			expect(
				server.exec(
					`SELECT id FROM listing WHERE json_extract(address, '$.city') = 'Hays'`,
				),
			).toEqual([{ id: row.id }]);
		});
	});

	it('takes raw SQL writes to a JSON column and rejects invalid JSON', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = boot(db);
			const row = server.create('listing', { title: 'Cottage' });
			server.exec(
				`UPDATE listing SET tags = json(?) WHERE id = ?`,
				'["lakefront"]',
				row.id,
			);
			expect(server.get('listing', row.id).tags).toEqual(['lakefront']);
			expect(ids(server, { where: { tags: { contains_any: ['lakefront'] } } })).toEqual([
				row.id,
			]);
			expect(() =>
				server.exec(`UPDATE listing SET tags = 'not json' WHERE id = ?`, row.id),
			).toThrow(/CHECK constraint failed/);
		});
	});

	it('removing a field clears its column', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = boot(db);
			const row = server.create('listing', { title: 'Loft', tags: ['downtown'] });
			server.update('listing', row.id, { tags: null } as never);
			expect(server.exec(`SELECT tags FROM listing WHERE id = ?`, row.id)).toEqual([
				{ tags: null },
			]);
			expect(server.get('listing', row.id).tags).toBeUndefined();
		});
	});

	it('reads rows still in the legacy layout, then moves them without re-syncing', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const first = boot(db);
			const farm = first.create('listing', {
				title: 'Farmhouse',
				tags: ['acreage'],
				address: { city: 'Hays', zip: '67601' },
				layout: [{ id: 'sig_1', page: 2 }],
			});
			const condo = first.create('listing', { title: 'Condo', tags: ['downtown'] });
			const stamped = first.get('listing', farm.id).updated_at;
			toLegacyLayout(db);
			expect(
				db.state.storage.sql
					.exec(`SELECT COUNT(*) AS n FROM listing WHERE tags IS NULL`)
					.one().n,
			).toBe(2);

			// The new version boots: the move runs in its first slice
			const server = boot(db);
			expect(server.schemaReport().json_columns_pending).toEqual([]);
			const [raw] = server.exec<Database.Row<typeof listing>>(
				`SELECT tags, address, layout, json, updated_at FROM listing WHERE id = ?`,
				farm.id,
			);
			expect(JSON.parse(raw.tags!)).toEqual(['acreage']);
			expect(JSON.parse(raw.layout!)).toEqual([{ id: 'sig_1', page: 2 }]);
			expect(raw.json).toBe('{}');
			// Not a change to the data: no new timestamp, nothing to catch up
			expect(raw.updated_at).toBe(stamped);
			expect(server.schemaReport().pending_changes).toBe(0);
			// Search filters over the moved fields
			expect(ids(server, { where: { tags: { contains_any: ['downtown'] } } })).toEqual([
				condo.id,
			]);
			expect(ids(server, { where: { 'address.city': 'Hays' } })).toEqual([farm.id]);
		});
	});

	it('serves legacy rows correctly before the move reaches them', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const first = boot(db);
			const farm = first.create('listing', {
				title: 'Farmhouse',
				tags: ['acreage'],
				address: { city: 'Hays', zip: '67601' },
			});
			toLegacyLayout(db);
			// A subclass that defers all migration work to the alarm
			class Deferred extends DatabaseServer<typeof TABLES> {
				protected override searchRebuildInConstructor() {
					return false;
				}
			}
			const server = new Deferred(TABLES, () => undefined, db.state, {
				DEV: true,
			} as never);
			expect(server.schemaReport().json_columns_pending).toEqual(['listing']);
			expect(server.get('listing', farm.id)).toMatchObject({
				tags: ['acreage'],
				address: { city: 'Hays', zip: '67601' },
			});
			expect(ids(server, { where: { tags: { contains_any: ['acreage'] } } })).toEqual([
				farm.id,
			]);
			expect(ids(server, { where: { 'address.city': 'Hays' } })).toEqual([farm.id]);
		});
	});

	it('moves a large table across alarm slices', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const first = boot(db);
			first.batch(() => {
				for (let i = 0; i < 1500; i++) {
					first.create('listing', { title: `Listing ${i}`, tags: [`t${i}`] });
				}
			});
			toLegacyLayout(db);
			class Small extends DatabaseServer<typeof TABLES> {
				protected override searchRebuildRowsPerSlice() {
					return 400;
				}
				// Treat this as a database too big to move in one wake.
				protected override jsonColumnMoveBytesInConstructor() {
					return 0;
				}
			}
			const server = new Small(TABLES, () => undefined, db.state, { DEV: true } as never);
			const remaining = () =>
				Number(
					db.state.storage.sql
						.exec(`SELECT COUNT(*) AS n FROM listing WHERE tags IS NULL`)
						.one().n,
				);
			expect(remaining()).toBe(1100);
			// The cursor is saved, so an instance evicted between slices resumes
			// where this one stopped instead of rescanning from the start.
			const saved = JSON.parse(
				String(db.state.storage.sql.exec(`SELECT json FROM state WHERE id = 'main'`).one().json),
			);
			expect(saved.json_columns_cursor.listing).toBeGreaterThan(0);
			const resumed = new Small(TABLES, () => undefined, db.state, { DEV: true } as never);
			expect(remaining()).toBe(700);
			void resumed;
			return (async () => {
				let alarms = 0;
				while (server.schemaReport().json_columns_pending.length && alarms < 10) {
					await server.alarm();
					alarms++;
				}
				expect(remaining()).toBe(0);
				expect(alarms).toBeGreaterThanOrEqual(2);
				expect(ids(server, { where: { tags: { contains_any: ['t1499'] } } })).toHaveLength(1);
			})();
		});
	});

	it('a raw clear on a row the move has not reached stays cleared', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const first = boot(db);
			const farm = first.create('listing', { title: 'Farmhouse', tags: ['acreage'] });
			toLegacyLayout(db);
			class Deferred extends DatabaseServer<typeof TABLES> {
				protected override searchRebuildInConstructor() {
					return false;
				}
			}
			const server = new Deferred(TABLES, () => undefined, db.state, { DEV: true } as never);
			expect(server.get('listing', farm.id).tags).toEqual(['acreage']);
			server.exec(`UPDATE listing SET tags = NULL WHERE id = ?`, farm.id);
			expect(server.get('listing', farm.id).tags).toBeUndefined();
			return (async () => {
				for (let i = 0; i < 5 && server.schemaReport().json_columns_pending.length; i++) {
					await server.alarm();
				}
				expect(server.schemaReport().json_columns_pending).toEqual([]);
				expect(server.get('listing', farm.id).tags).toBeUndefined();
				expect(server.exec(`SELECT tags FROM listing WHERE id = ?`, farm.id)).toEqual([
					{ tags: null },
				]);
				// The guard triggers are gone once the move is done
				expect(
					db.state.storage.sql
						.exec(`SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE '_mv_%'`)
						.one().n,
				).toBe(0);
			})();
		});
	});

	it('upgrades generated search columns built with the old expression', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const first = boot(db);
			const farm = first.create('listing', { title: 'Farmhouse', address: { city: 'Hays', zip: '1' } });
			// As 2.5.1 built it: the generated column read only the overflow blob
			const sql = db.state.storage.sql;
			sql.exec(`DROP INDEX "idx_listing_address__city"`);
			sql.exec(`ALTER TABLE listing DROP COLUMN "sv$address__city"`);
			sql.exec(
				`ALTER TABLE listing ADD COLUMN "sv$address__city" GENERATED ALWAYS AS (json_extract("json", '$.address.city')) VIRTUAL`,
			);
			sql.exec(`CREATE INDEX "idx_listing_address__city" ON listing ("sv$address__city")`);
			// With values in their column, the old expression finds nothing
			expect(ids(first, { where: { 'address.city': 'Hays' } })).toEqual([]);
			const server = boot(db);
			const table_sql = String(
				sql.exec(`SELECT sql FROM sqlite_schema WHERE name = 'listing'`).one().sql,
			);
			expect(table_sql).toContain(`COALESCE(json_extract("address", '$.city')`);
			expect(ids(server, { where: { 'address.city': 'Hays' } })).toEqual([farm.id]);
		});
	});
});
