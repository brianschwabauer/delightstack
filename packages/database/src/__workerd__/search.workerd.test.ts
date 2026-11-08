/**
 * The search index in real DO SQLite: the compact layout's write costs,
 * keyword fields, highlights through `list()`, the term-first filter path and
 * `searchReport()`.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Database } from '../schema/schema.js';
import { DatabaseServer } from '../server/db.server.js';
import { measure } from './fixtures.js';
import type { BareDatabase } from './worker.js';

const note = Database.table('note', (s) => ({
	title: s.string().searchable({ weight: 2 }),
	body: s.string().searchable(),
	status: s.enum(['open', 'closed']).searchable(),
	thumbnail_key: s.string().keyword().optional(),
	code: s.string().searchable({ text: true }).optional(),
}));
const TABLES = { note };

function stub() {
	return env.BARE.get(env.BARE.idFromName(`search-${crypto.randomUUID()}`));
}
function boot(db: BareDatabase) {
	return new DatabaseServer(TABLES, () => undefined, db.state, { DEV: true } as never);
}
type Hit = {
	id: string;
	document: Record<string, unknown>;
	highlights?: Record<string, { text: string; ranges: [number, number][] }>;
};
const list = (server: DatabaseServer<typeof TABLES>, query: Record<string, unknown>) =>
	server.list('note', query as never) as unknown as { count: number; hits: Hit[] };

describe('write costs', () => {
	it('adding a word to a long body rewrites a few rows, not every posting', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = boot(db);
			const body = Array.from({ length: 2000 }, (_, i) => `word${i % 900}`).join(' ');
			const created = server.create('note', { title: 'Long', body, status: 'open' });
			const cost = measure(db.state, () => {
				server.update('note', created.id as string, { body: `${body} extra` });
			});
			// The entity row + its index entries, the new word's entry and
			// dictionary row, the document row, the field stats.
			expect(cost.written).toBeLessThanOrEqual(10);
		});
	});

	it('never indexes a keyword field as words', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = boot(db);
			server.create('note', {
				title: 'Hello',
				body: 'x',
				status: 'open',
				thumbnail_key: 'thumbs/0VYjvMDfgv8hlfcLqiPO/p1.avif',
			});
			const fields = db.state.storage.sql
				.exec(
					`SELECT DISTINCT f.field AS field FROM search_entries e JOIN search_fields f ON f.fid = e.fid`,
				)
				.toArray()
				.map((row) => row.field);
			expect(fields).not.toContain('thumbnail_key');
			// Still filterable, exactly.
			expect(
				list(server, { where: { thumbnail_key: 'thumbs/0VYjvMDfgv8hlfcLqiPO/p1.avif' } })
					.count,
			).toBe(1);
		});
	});
});

describe('list()', () => {
	it('returns highlights when asked, in sparse and full mode', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = boot(db);
			server.create('note', {
				title: 'Residential sale contract',
				body: 'Closing is set for Friday.',
				status: 'open',
			});
			for (const sparse of [true, false]) {
				const [hit] = list(server, {
					term: 'contract friday',
					highlight: true,
					sparse,
				}).hits;
				expect(hit.highlights?.title?.text).toBe('Residential sale contract');
				const body = hit.highlights?.body;
				expect(body && body.text.slice(body.ranges[0][0], body.ranges[0][1])).toBe(
					'Friday',
				);
			}
			expect(list(server, { term: 'contract' }).hits[0].highlights).toBeUndefined();
		});
	});

	it('gives the same answer for a term with a filter whether few or many documents match', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = boot(db);
			server.batch(() => {
				for (let i = 0; i < 1200; i++) {
					server.create('note', {
						title: i % 3 === 0 ? 'common rare' : 'common',
						body: `note ${i}`,
						status: i % 2 === 0 ? 'open' : 'closed',
					});
				}
			});
			// > 900 matches: the filter's ids are read once.
			const many = list(server, {
				term: 'common',
				where: { status: 'open' },
				limit: 2000,
			});
			expect(many.count).toBe(600);
			expect(many.hits.every((hit) => hit.document.status === 'open')).toBe(true);
			// ≤ 900 matches: only the matched ids are checked.
			const few = list(server, {
				term: 'rare',
				where: { status: 'closed' },
				limit: 2000,
			});
			expect(few.count).toBe(200);
			expect(few.hits.every((hit) => hit.document.status === 'closed')).toBe(true);
		});
	});
});

describe('searchReport()', () => {
	it('sizes each field and warns about id-like text and capped values', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = boot(db);
			const long = Array.from({ length: 1200 }, (_, i) => `w${i}`).join(' ');
			server.batch(() => {
				for (let i = 0; i < 300; i++) {
					server.create('note', {
						title: 'Weekly report',
						body: i === 0 ? long : 'short body',
						status: 'open',
						code: crypto.randomUUID().replace(/-/g, ''),
					});
				}
			});
			const report = server.searchReport();
			const table = report.tables.find((entry) => entry.entity_type === 'note')!;
			expect(table.documents).toBe(300);
			const code = table.fields.find((field) => field.field === 'code')!;
			expect(code.words).toBeGreaterThan(250);
			expect(code.warnings.join(' ')).toMatch(/keyword/);
			const body = table.fields.find((field) => field.field === 'body')!;
			expect(body.capped_documents).toBe(1);
			expect(body.max_tokens).toBe(1000);
			expect(report.warnings.some((warning) => warning.startsWith('note.body:'))).toBe(
				true,
			);
			const title = table.fields.find((field) => field.field === 'title')!;
			expect(title.warnings).toEqual([]);
		});
	});
});

describe('a table with nothing to search', () => {
	const log = Database.table('log', (s) => ({
		note_id: s.string().indexable(),
		kind: s.enum(['opened', 'signed']),
		detail: s.string().optional(),
	}));
	const LOG_TABLES = { log };
	const bootLog = (db: BareDatabase, tables: Record<string, unknown> = LOG_TABLES) =>
		new DatabaseServer(tables as never, () => undefined, db.state, { DEV: true } as never) as unknown as {
			create(type: string, data: Record<string, unknown>): { id: string };
			delete(type: string, id: string): unknown;
			exec(sql: string, ...bindings: unknown[]): unknown;
			alarm(): Promise<void>;
		};
	const sql = (db: BareDatabase, query: string, ...bindings: unknown[]) =>
		db.state.storage.sql.exec(query, ...bindings).toArray();
	const documents = (db: BareDatabase, type = 'log') =>
		Number(sql(db, `SELECT COUNT(*) AS n FROM search_documents WHERE entity_type = ?`, type)[0].n);
	const state = (db: BareDatabase, type = 'log') =>
		sql(db, `SELECT doc_count, config_version FROM search_state WHERE entity_type = ?`, type)[0] as {
			doc_count: number;
			config_version: number;
		};

	it('writes no index row, and the state row once per create', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = bootLog(db);
			server.create('log', { note_id: 'n1', kind: 'opened' });
			const cost = measure(db.state, () => {
				server.create('log', { note_id: 'n1', kind: 'signed', detail: 'field 3' });
			});
			// The row, its primary key, note_id and updated_at index entries, and
			// the state row (clock and count in one write).
			expect(cost.written).toBe(5);
			expect(documents(db)).toBe(0);
			expect(state(db).doc_count).toBe(2);
		});
	});

	it('keeps doc_count exact through library, raw and repeated deletes', async () => {
		await runInDurableObject(stub(), (db: BareDatabase) => {
			const server = bootLog(db);
			const ids = [0, 1, 2].map((i) => server.create('log', { note_id: `n${i}`, kind: 'opened' }).id);
			server.delete('log', ids[0]);
			expect(state(db).doc_count).toBe(2);
			// Deleting what is already gone changes nothing.
			try {
				server.delete('log', ids[0]);
			} catch {
				// a missing row may throw; either way the count must hold
			}
			expect(state(db).doc_count).toBe(2);
			server.exec(
				`INSERT INTO log (id, note_id, kind, created_at, updated_at) VALUES ('raw1', 'n9', 'opened', 1, 1)`,
			);
			expect(state(db).doc_count).toBe(3);
			server.exec(`UPDATE log SET detail = 'x' WHERE id = 'raw1'`);
			expect(state(db).doc_count).toBe(3);
			server.exec(`DELETE FROM log WHERE id = ?`, ids[1]);
			expect(state(db).doc_count).toBe(2);
			expect(documents(db)).toBe(0);
		});
	});

	it('clears the empty rows an older version wrote, without making clients resync', async () => {
		await runInDurableObject(stub(), async (db: BareDatabase) => {
			const first = bootLog(db) as unknown as {
				create(type: string, data: Record<string, unknown>): { id: string };
				searchSchemaSignature(type: string, with_layout?: boolean): string;
				setSearchTableState(type: string, value: unknown): void;
			};
			const ids = [0, 1, 2, 3, 4].map((i) => first.create('log', { note_id: `n${i}`, kind: 'opened' }).id);
			// What 3.0.0 left behind: an empty document row per entity, under a
			// signature without the layout marker.
			for (const id of ids) {
				sql(db, `INSERT INTO search_documents (entity_type, doc_id, lengths, terms) VALUES ('log', ?, '{}', '{}')`, id);
			}
			first.setSearchTableState('log', {
				schema_signature: first.searchSchemaSignature('log', false),
				migrated: true,
			});
			const version = state(db).config_version;

			const next = bootLog(db);
			for (let i = 0; i < 5 && documents(db) > 0; i++) await next.alarm();
			expect(documents(db)).toBe(0);
			expect(state(db).doc_count).toBe(5);
			expect(state(db).config_version).toBe(version);
			next.create('log', { note_id: 'n5', kind: 'signed' });
			expect(state(db).doc_count).toBe(6);
		});
	});

	it('counts and clears a table whose last searchable field is removed', async () => {
		await runInDurableObject(stub(), async (db: BareDatabase) => {
			const before = Database.table('item', (s) => ({ label: s.string().searchable() }));
			const after = Database.table('item', (s) => ({ label: s.string() }));
			const first = bootLog(db, { item: before });
			for (let i = 0; i < 4; i++) first.create('item', { label: `Checklist item ${i}` });
			expect(documents(db, 'item')).toBe(4);
			const version = state(db, 'item').config_version;

			const next = bootLog(db, { item: after });
			for (let i = 0; i < 5 && documents(db, 'item') > 0; i++) await next.alarm();
			expect(documents(db, 'item')).toBe(0);
			expect(Number(sql(db, `SELECT COUNT(*) AS n FROM search_entries`)[0].n)).toBe(0);
			expect(state(db, 'item').doc_count).toBe(4);
			// The schema clients hold changed: they resync.
			expect(state(db, 'item').config_version).toBe(version + 1);
		});
	});
});
