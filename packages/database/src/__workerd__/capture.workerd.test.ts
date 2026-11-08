/**
 * D5 in workerd: writes that bypass the library are caught up.
 *
 * Every scenario here was silently wrong before change capture: the search
 * index, sync timestamps, history and websocket broadcasts only followed
 * writes made through `create`/`update`/`delete`.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Database } from '../schema/schema.js';
import { DatabaseServer, scoped } from '../server/db.server.js';
import { TABLES, measure } from './fixtures.js';
import type { BareDatabase, TestDatabase } from './worker.js';

type Change = { action: string; entity_type: string; id: string | number };

function open(db: TestDatabase) {
	const broadcasts: Change[] = [];
	const server = new DatabaseServer(
		TABLES,
		() => ({
			entityChanged() {},
			entitiesChanged(changes: Change[]) {
				broadcasts.push(...changes);
			},
		}),
		db.state,
		{ DEV: true } as never,
	);
	return { server, broadcasts };
}

/** Catch-up broadcasts go out once the current synchronous run has ended. */
const settled = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function stub() {
	return env.DB.get(env.DB.idFromName(`capture-${crypto.randomUUID()}`));
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

function pending(db: TestDatabase): number {
	return Number(db.state.storage.sql.exec(`SELECT COUNT(*) AS n FROM _changes`).one().n);
}

function hits(
	server: DatabaseServer<typeof TABLES>,
	type: 'deal' | 'participant',
	term: string,
) {
	return (server.list(type, { term } as never) as { hits: { id: string }[] }).hits.map(
		(h) => h.id,
	);
}

describe('library writes', () => {
	it('never touch _changes, so they cost no extra row', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			// Every capture is copied here, so a capture that was drained before
			// the assertion still counts.
			const sql = db.state.storage.sql;
			sql.exec(`CREATE TABLE captured (entity_type TEXT, op TEXT)`);
			sql.exec(
				`CREATE TRIGGER count_captures AFTER INSERT ON _changes BEGIN INSERT INTO captured VALUES (NEW.entity_type, NEW.op); END`,
			);
			const captured = () => Number(sql.exec(`SELECT COUNT(*) AS n FROM captured`).one().n);
			const deal = seedDeal(server);
			expect(captured()).toBe(0);
			server.update('deal', deal.id, { notes: 'x', address: '9 Oak Street' });
			expect(captured()).toBe(0);
			const person = server.create('person', { name: 'Ann' });
			const participant = server.create('participant', {
				deal_id: deal.id,
				person_id: person.id,
				name: 'Ann',
				role: 'buyer',
			});
			expect(captured()).toBe(0);
			server.delete('participant', participant.id);
			expect(captured()).toBe(0);
			server.transaction([
				{ update: { type: 'deal', id: deal.id, data: { status: 'active' } } },
			]);
			server.batch(() => {
				server.update('person', person.id, { name: 'Ann B' });
				server.create('person', { name: 'Bo' });
			});
			expect(captured()).toBe(0);
		});
	});
});

describe('raw SQL writes', () => {
	it('a raw UPDATE is re-indexed, re-stamped for sync and broadcast', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server, broadcasts } = open(db);
			const deal = seedDeal(server);
			const before = server.get('deal', deal.id);
			broadcasts.length = 0;

			server.exec(
				`UPDATE deal SET address = ? WHERE id = ?`,
				'77 Sunflower Lane',
				deal.id,
			);

			expect(pending(db)).toBe(0);
			expect(hits(server, 'deal', 'sunflower')).toEqual([deal.id]);
			expect(hits(server, 'deal', 'elm')).toEqual([]);
			const after = server.get('deal', deal.id);
			expect(after.updated_at).toBeGreaterThan(before.updated_at);
			const sync = server.sync({
				entity: { deal: { start_updated_at: before.updated_at } },
			} as never) as {
				entity: { deal: { updated: { id: string }[]; created: { id: string }[] } };
			};
			const synced = [...sync.entity.deal.updated, ...sync.entity.deal.created].map(
				(d) => d.id,
			);
			expect(synced).toContain(deal.id);
			await settled();
			expect(broadcasts).toEqual([
				expect.objectContaining({ action: 'updated', entity_type: 'deal', id: deal.id }),
			]);
		});
	});

	it('a raw INSERT is indexed and gets real timestamps', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server, broadcasts } = open(db);
			server.exec(
				`INSERT INTO deal (id, address, city, state, postal_code, kind, status, created_at, updated_at)
				 VALUES ('raw1', '5 Prairie Road', 'Topeka', 'KS', '66603', 'listing', 'draft', 0, 0)`,
			);
			expect(hits(server, 'deal', 'prairie')).toEqual(['raw1']);
			const row = server.get('deal', 'raw1');
			expect(row.created_at).toBeGreaterThan(0);
			expect(row.updated_at).toBeGreaterThan(0);
			await settled();
			expect(broadcasts).toEqual([
				expect.objectContaining({ action: 'created', entity_type: 'deal', id: 'raw1' }),
			]);
		});
	});

	it('a raw DELETE leaves search and ships a sync tombstone', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server, broadcasts } = open(db);
			const deal = seedDeal(server);
			const at = server.get('deal', deal.id).updated_at;
			broadcasts.length = 0;
			server.exec(`DELETE FROM deal WHERE id = ?`, deal.id);
			expect(hits(server, 'deal', 'elm')).toEqual([]);
			const sync = server.sync({
				entity: { deal: { start_updated_at: at } },
			} as never) as {
				entity: { deal: { deleted: (string | number)[] } };
			};
			expect(sync.entity.deal.deleted.map(String)).toContain(deal.id);
			await settled();
			expect(broadcasts).toEqual([
				expect.objectContaining({ action: 'deleted', entity_type: 'deal', id: deal.id }),
			]);
		});
	});

	it('keeps a raw updated_at only when it is ahead of the sync clock', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			const deal = seedDeal(server);
			const ahead = Date.now() + 60_000;
			server.exec(`UPDATE deal SET updated_at = ?, city = 'Emporia' WHERE id = ?`, ahead, deal.id);
			expect(server.get('deal', deal.id).updated_at).toBe(ahead);
			// ...and the rest of the catch-up still happened
			expect(hits(server, 'deal', 'emporia')).toEqual([deal.id]);
		});
	});

	it('re-stamps a raw updated_at that would sit under a client cursor', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			// A burst of library writes runs the type's clock ahead of the wall clock
			server.transaction(
				Array.from({ length: 80 }, (_, i) => ({
					create: {
						type: 'deal' as const,
						data: {
							address: `${i} Burst Lane`,
							city: 'Wichita',
							state: 'KS',
							postal_code: '67202',
							kind: 'purchase',
							status: 'draft',
						},
					},
				})),
			);
			const cursor = (
				server.sync({ entity: { deal: { start_updated_at: 0, limit: 500 } } } as never) as {
					entity: { deal: { end_updated_at: number } };
				}
			).entity.deal.end_updated_at;
			// Backdated, and a raw insert stamped with the (now lagging) wall clock
			const backdated = seedDeal(server);
			server.exec(`UPDATE deal SET updated_at = 1, city = 'Hays' WHERE id = ?`, backdated.id);
			server.exec(
				`INSERT INTO deal (id, address, city, state, postal_code, kind, status, created_at, updated_at)
				 VALUES ('rawnow', '5 Raw Road', 'Hays', 'KS', '67601', 'listing', 'draft', ?, ?)`,
				Date.now(),
				Date.now(),
			);
			const next = server.sync({
				entity: { deal: { start_updated_at: cursor, limit: 500 } },
			} as never) as {
				entity: { deal: { created: { id: string }[]; updated: { id: string }[] } };
			};
			const seen = [...next.entity.deal.created, ...next.entity.deal.updated].map((d) => d.id);
			expect(seen).toContain(backdated.id);
			expect(seen).toContain('rawnow');
			expect(server.get('deal', backdated.id).updated_at).toBeGreaterThan(cursor);
		});
	});

	it('broadcasts nothing for a raw write whose outer transaction rolled back', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server, broadcasts } = open(db);
			const deal = seedDeal(server);
			await settled();
			broadcasts.length = 0;
			expect(() =>
				db.state.storage.transactionSync(() => {
					server.exec(`UPDATE deal SET city = 'Ghost Town' WHERE id = ?`, deal.id);
					throw new Error('the app changed its mind');
				}),
			).toThrow(/changed its mind/);
			await settled();
			expect(broadcasts).toEqual([]);
			expect(hits(server, 'deal', 'ghost')).toEqual([]);
			expect(server.get('deal', deal.id).city).toBe('Wichita');
		});
	});

	it('a write through ctx.storage.sql is caught up by the next read', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			const deal = seedDeal(server);
			db.state.storage.sql.exec(`UPDATE deal SET city = 'Salina' WHERE id = ?`, deal.id);
			expect(pending(db)).toBe(1);
			expect(hits(server, 'deal', 'salina')).toEqual([deal.id]);
			expect(pending(db)).toBe(0);
		});
	});

	it('changing a primary key in raw SQL drops the old id from search', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			const deal = seedDeal(server);
			server.exec(`UPDATE deal SET id = 'renamed' WHERE id = ?`, deal.id);
			expect(hits(server, 'deal', 'elm')).toEqual(['renamed']);
		});
	});

	it('several raw writes to one row become one catch-up', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server, broadcasts } = open(db);
			const deal = seedDeal(server);
			broadcasts.length = 0;
			db.state.storage.sql.exec(`UPDATE deal SET notes = 'a' WHERE id = ?`, deal.id);
			db.state.storage.sql.exec(`UPDATE deal SET notes = 'b' WHERE id = ?`, deal.id);
			db.state.storage.sql.exec(`UPDATE deal SET city = 'Hays' WHERE id = ?`, deal.id);
			expect(server.drainChanges()).toBe(1);
			await settled();
			expect(broadcasts).toHaveLength(1);
			expect(hits(server, 'deal', 'hays')).toEqual([deal.id]);
		});
	});

	it('records history for a raw write, attributed to the scoped actor', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			const deal = seedDeal(server);
			const doc = server.create('document', {
				deal_id: deal.id,
				name: 'Contract',
				status: 'draft',
				field_values: '{}',
			});
			scoped(server, 'agent:claude').exec(
				`UPDATE document SET field_values = ? WHERE id = ?`,
				'{"price":"350000"}',
				doc.id,
			);
			const history = server.history('document', doc.id);
			const update = history.find((entry) => entry.operation === 'update');
			expect(update?.actor).toBe('agent:claude');
			expect(update?.patch).toEqual({ field_values: '{"price":"350000"}' });
			expect(update?.previous).toEqual({ field_values: '{}' });
		});
	});
});

describe('foreign-key cascades', () => {
	it('ON DELETE CASCADE children leave search, history and sync', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server, broadcasts } = open(db);
			const deal = seedDeal(server);
			const participant = server.create('participant', {
				deal_id: deal.id,
				name: 'Quincy Seller',
				role: 'seller',
			});
			const doc = server.create('document', {
				deal_id: deal.id,
				name: 'Listing Agreement',
				status: 'draft',
				field_values: '{}',
			});
			expect(hits(server, 'participant', 'quincy')).toEqual([participant.id]);
			broadcasts.length = 0;

			server.delete('deal', deal.id); // SQLite cascades to both children
			// Caught up before delete() returned, not at some later read
			expect(pending(db)).toBe(0);
			expect(
				Number(
					db.state.storage.sql
						.exec(`SELECT COUNT(*) AS n FROM search_documents WHERE doc_id = ?`, participant.id)
						.one().n,
				),
			).toBe(0);

			expect(hits(server, 'participant', 'quincy')).toEqual([]);
			const indexed = db.state.storage.sql
				.exec(
					`SELECT COUNT(*) AS n FROM search_documents WHERE doc_id IN (?, ?)`,
					participant.id,
					doc.id,
				)
				.one().n;
			expect(indexed).toBe(0);
			expect(server.history('document', doc.id).map((e) => e.operation)).toContain(
				'delete',
			);
			await settled();
			expect(broadcasts.map((b) => `${b.action}:${b.entity_type}`).sort()).toEqual([
				'deleted:deal',
				'deleted:document',
				'deleted:participant',
			]);
		});
	});

	it('ON DELETE SET NULL children are re-stamped so sync picks them up', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			const deal = seedDeal(server);
			const person = server.create('person', { name: 'Pat' });
			const participant = server.create('participant', {
				deal_id: deal.id,
				person_id: person.id,
				name: 'Pat',
				role: 'agent',
			});
			const stamped = server.get('participant', participant.id).updated_at;
			server.delete('person', person.id);
			const after = server.get('participant', participant.id);
			expect(after.person_id).toBeUndefined();
			expect(after.updated_at).toBeGreaterThan(stamped);
		});
	});
});

describe('cost of catching up', () => {
	it('a raw update of a plain column bills a handful of rows', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			const deal = seedDeal(server);
			const cost = measure(db.state, () =>
				server.exec(`UPDATE deal SET notes = 'raw' WHERE id = ?`, deal.id),
			);
			// row + _changes insert + _changes delete + re-stamp + sync clock
			expect(cost.written).toBeLessThanOrEqual(7);
		});
	});
});

describe('a database wiped under a live instance', () => {
	it('keeps answering raw reads after ctx.storage.deleteAll()', async () => {
		await runInDurableObject(stub(), async (db: TestDatabase) => {
			const { server } = open(db);
			seedDeal(server);
			await db.state.storage.deleteAll();
			// No `_changes` table any more: the pending check must not throw
			expect(server.exec(`SELECT name FROM sqlite_schema WHERE type = 'table'`)).toEqual([]);
		});
	});
});

describe('a row the catch-up cannot process', () => {
	it('is set aside instead of blocking every request', async () => {
		await runInDurableObject(
			env.BARE.get(env.BARE.idFromName(`poison-${crypto.randomUUID()}`)),
			async (bare: BareDatabase) => {
				const table = Database.table('clip', (s) => ({
					title: s.string().searchable(),
					embedding: s.vector(3).optional(),
				}));
				const server = new DatabaseServer({ clip: table }, () => undefined, bare.state, {
					DEV: true,
				} as never);
				const good = server.create('clip', { title: 'good one' });
				const bad = server.create('clip', { title: 'bad one', embedding: [1, 0, 0] });
				// A zero vector can't be normalized: indexing it throws
				bare.state.storage.sql.exec(`UPDATE clip SET embedding = '[0,0,0]' WHERE id = ?`, bad.id);
				bare.state.storage.sql.exec(`UPDATE clip SET title = 'good two' WHERE id = ?`, good.id);
				// Reads keep working, and the good row is caught up
				const titles = (server.list('clip', { term: 'two' } as never) as { hits: { id: string }[] })
					.hits.map((hit) => hit.id);
				expect(titles).toEqual([good.id]);
				const report = server.schemaReport();
				expect(report.pending_changes).toBe(0);
				expect(report.failed_changes).toEqual([
					expect.objectContaining({ entity_type: 'clip', entity_id: bad.id }),
				]);
				// And a new wake doesn't trip over it either
				const woken = new DatabaseServer({ clip: table }, () => undefined, bare.state, {
					DEV: true,
				} as never);
				expect(woken.get('clip', good.id).title).toBe('good two');
			},
		);
	});
});
