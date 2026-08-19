// @vitest-environment node
/**
 * The "carried, not indexed" field tier.
 *
 * A field can reach the client in three different ways, and this suite pins
 * down the difference between them:
 *
 * | tier       | in `toSparse()` / `sync()` | in the search index |
 * |------------|----------------------------|---------------------|
 * | searchable | yes                        | yes                 |
 * | carried    | yes                        | **no**              |
 * | excluded   | no                         | no                   |
 *
 * `schema.file()` is carried by default (a client needs the descriptor to build
 * a URL) and `schema.blob()` is excluded with no way to opt in (raw bytes must
 * never be broadcast to every connected client). That asymmetry is deliberate
 * and is asserted here so nobody "fixes" it by making the two consistent.
 *
 * The projection assertions run against the pure schema layer; the sync and
 * query assertions run the production `DatabaseServer` against real SQLite via
 * the shared harness, because "reaches a sync payload" and "cannot be filtered
 * on" are both statements about the driver, not about `table()`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from './schema';
import { DatabaseServer } from '../server/db.server';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';
import { DelightError } from '@delightstack/utilities';

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	}
	return { DurableObject };
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One table exercising all three tiers at once: a searchable string, a carried
 * string, a carried object, an object holding one searchable and one carried
 * leaf, a carried `file()` (implicitly) and an excluded `blob()`.
 */
const assetTable = Database.table('asset', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	/** The motivating general case: a big body the client renders, nobody searches. */
	rendered_html: s.string().carried().optional(),
	/** A whole carried subtree — carried applies to the object, not its leaves. */
	layout: s
		.object({
			columns: s.number(),
			gutter: s.number(),
		})
		.carried()
		.optional(),
	/** An indexed object with one carried leaf: the leaf must NOT be indexed. */
	meta: s
		.object({
			caption: s.string().searchable(),
			thumbnail_css: s.string().carried().optional(),
		})
		.optional(),
	/** Carried automatically — no `.carried()` call anywhere. */
	source: s.file({ store: 'MEDIA' }).optional(),
	/** Excluded from both tiers, with no builder to change that. */
	bytes: s.blob({ max_bytes: 1_000 }).optional(),
}));

const CONFIG = { asset: assetTable } as unknown as Record<string, Database.Table>;

const FILE_REFERENCE = {
	key: 'media/hero.png',
	size: 2048,
	mime: 'image/png',
	sha256: 'a'.repeat(64),
	name: 'hero.png',
};

/** A full, valid entity for the fixture table. */
function assetInput(overrides: Record<string, unknown> = {}) {
	return {
		id: 'asset-1',
		title: 'Hero shot',
		rendered_html: '<p>Hero shot</p>',
		layout: { columns: 3, gutter: 16 },
		meta: { caption: 'On the beach', thumbnail_css: 'filter:blur(4px)' },
		source: FILE_REFERENCE,
		...overrides,
	};
}

const open_states: ReturnType<typeof createDurableObjectState>[] = [];

function createServer(config: Record<string, Database.Table> = CONFIG) {
	const state = createDurableObjectState();
	open_states.push(state);
	const db = new DatabaseServer(
		config as never,
		() => undefined,
		state.ctx as never,
		{ DEV: true } as never,
	) as DatabaseServer<Record<string, Database.Table>>;
	return { db, state };
}

afterEach(() => {
	while (open_states.length) open_states.pop()?.close();
});

/** The documents one full sync of the fixture table yields. */
function syncedDocuments(
	db: DatabaseServer<Record<string, Database.Table>>,
): Record<string, unknown>[] {
	const entity = db.sync({ entity: { asset: { start_updated_at: 0 } } }).entity
		.asset as unknown as {
		created: Record<string, unknown>[];
		updated: Record<string, unknown>[];
	};
	return [...entity.created, ...entity.updated];
}

/* -------------------------------------------------------------------------- */
/* The table config: which tier each field landed in                          */
/* -------------------------------------------------------------------------- */

describe('carried fields: table config', () => {
	it('lists carried paths in `carried_fields`, and nowhere else', () => {
		const { config } = assetTable;
		expect(config.carried_fields).toEqual(
			expect.arrayContaining(['rendered_html', 'layout', 'meta.thumbnail_css', 'source']),
		);
		// The whole point of the tier: carried and searchable are disjoint sets.
		for (const field of config.carried_fields) {
			expect(config.searchable_fields).not.toContain(field);
			expect(config.sortable_fields).not.toContain(field);
		}
	});

	it('keeps carried fields out of the index schema at every depth', () => {
		const index_schema = assetTable.config.index_schema as Record<string, unknown>;
		expect(index_schema).toHaveProperty('title', 'string');

		expect(index_schema).not.toHaveProperty('rendered_html');
		expect(index_schema).not.toHaveProperty('layout');
		expect(index_schema).not.toHaveProperty('source');

		// A carried leaf sitting next to an indexed one: the object contributes
		// `meta.caption` to the index and nothing else.
		expect(index_schema.meta).toEqual({ caption: 'string' });
	});

	it('excludes a blob from both tiers', () => {
		const { config } = assetTable;
		expect(config.carried_fields).not.toContain('bytes');
		expect(config.searchable_fields).not.toContain('bytes');
		expect(config.index_schema).not.toHaveProperty('bytes');
		// It is still a real SQLite column — excluded from the wire, not from storage.
		expect(config.blob_fields).toContain('bytes');
		expect(config.table_definition.bytes).toContain('BLOB');
	});

	it('carries a `file()` field with no `.carried()` call', () => {
		const table = Database.table('doc', (s) => ({
			id: s.primaryKey(),
			attachment: s.file({ store: 'MEDIA' }),
		}));
		expect(table.config.carried_fields).toContain('attachment');
		expect(table.config.file_fields.attachment).toEqual({ store: 'MEDIA' });
		expect(table.config.index_schema).not.toHaveProperty('attachment');
	});

	it('`file({ carried: false })` reaches neither tier', () => {
		// The opt-out for a private object key that should not sit in every
		// browser's IndexedDB. Still stored on the row and readable with
		// `db.get()`; simply never synced and never indexed.
		const table = Database.table('doc', (s) => ({
			id: s.primaryKey(),
			public_image: s.file({ store: 'MEDIA' }),
			private_scan: s.file({ store: 'PRIVATE', carried: false }),
		}));
		const config = table.config;

		expect(config.carried_fields).toContain('public_image');
		expect(config.carried_fields).not.toContain('private_scan');
		expect(config.searchable_fields).not.toContain('private_scan');
		expect(config.index_schema).not.toHaveProperty('private_scan');
		// The store binding is still recorded — the value lives on the row, so
		// server-side code can still resolve it.
		expect(config.file_fields.private_scan).toEqual({ store: 'PRIVATE' });
	});

	it('omits a non-carried `file()` from the sparse projection', () => {
		const table = Database.table('doc', (s) => ({
			id: s.primaryKey(),
			public_image: s.file({ store: 'MEDIA' }),
			private_scan: s.file({ store: 'PRIVATE', carried: false }),
		}));
		const sparse = table.toSparse({
			id: 'doc_1',
			created_at: 0,
			updated_at: 0,
			public_image: { key: 'a', size: 1, mime: 'image/avif' },
			private_scan: { key: 'secret', size: 2, mime: 'application/pdf' },
		});

		expect(sparse.public_image).toEqual({ key: 'a', size: 1, mime: 'image/avif' });
		expect('private_scan' in sparse).toBe(false);
	});

	it('refuses a field that is both carried and searchable', () => {
		expect(() =>
			Database.table('bad', (s) => ({
				id: s.primaryKey(),
				body: s.string().searchable().carried(),
			})),
		).toThrow(DelightError);
		expect(() =>
			Database.table('bad', (s) => ({
				id: s.primaryKey(),
				body: s.string().sortable().carried(),
			})),
		).toThrow(/mutually exclusive/);
	});
});

/* -------------------------------------------------------------------------- */
/* The projection                                                             */
/* -------------------------------------------------------------------------- */

describe('carried fields: toSparse()', () => {
	it('copies carried values into the sparse document', () => {
		const entity = assetTable.parse(assetInput());
		const sparse = assetTable.toSparse(entity) as Record<string, unknown>;

		expect(sparse.title).toBe('Hero shot');
		expect(sparse.rendered_html).toBe('<p>Hero shot</p>');
		expect(sparse.layout).toEqual({ columns: 3, gutter: 16 });
		expect(sparse.source).toEqual(FILE_REFERENCE);
		// The searchable leaf and the carried leaf of the same object, side by side.
		expect(sparse.meta).toEqual({
			caption: 'On the beach',
			thumbnail_css: 'filter:blur(4px)',
		});
	});

	it('never copies a blob', () => {
		const entity = assetTable.parse(assetInput({ bytes: new Uint8Array([1, 2, 3]) }));
		const sparse = assetTable.toSparse(entity) as Record<string, unknown>;
		expect(sparse).not.toHaveProperty('bytes');
	});

	it('omits a carried field that has no value', () => {
		const entity = assetTable.parse({ id: 'asset-2', title: 'Bare' });
		const sparse = assetTable.toSparse(entity) as Record<string, unknown>;
		expect(sparse.title).toBe('Bare');
		expect('rendered_html' in sparse).toBe(false);
		expect('source' in sparse).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* The wire                                                                   */
/* -------------------------------------------------------------------------- */

describe('carried fields: sync()', () => {
	it('ships carried fields in the sync payload and drops the blob', () => {
		const { db } = createServer();
		db.create('asset', assetInput({ bytes: new Uint8Array([1, 2, 3]) }) as never);

		const docs = syncedDocuments(db);
		expect(docs).toHaveLength(1);
		const [doc] = docs;

		expect(doc.title).toBe('Hero shot');
		expect(doc.rendered_html).toBe('<p>Hero shot</p>');
		expect(doc.layout).toEqual({ columns: 3, gutter: 16 });
		expect(doc.source).toEqual(FILE_REFERENCE);
		expect((doc.meta as Record<string, unknown>).thumbnail_css).toBe('filter:blur(4px)');

		// Raw bytes are the one thing that never crosses the wire.
		expect('bytes' in doc).toBe(false);
	});

	it('round-trips a carried field through an update', () => {
		const { db } = createServer();
		const created = db.create('asset', assetInput() as never) as unknown as {
			id: string;
		};
		db.update('asset', created.id, { rendered_html: '<p>Edited</p>' } as never);

		const docs = syncedDocuments(db);
		expect(docs).toHaveLength(1);
		expect(docs[0].rendered_html).toBe('<p>Edited</p>');
	});
});

/* -------------------------------------------------------------------------- */
/* The query layer                                                            */
/* -------------------------------------------------------------------------- */

describe('carried fields: not queryable', () => {
	/** A carried field must be rejected, whichever surface reaches for it. */
	function expectRejected(fn: () => unknown) {
		expect(fn).toThrow(DelightError);
		try {
			fn();
		} catch (error) {
			expect(DelightError.from(error).status).toBe(400);
		}
	}

	it('rejects a carried field in a `where` clause', () => {
		const { db } = createServer();
		db.create('asset', assetInput() as never);
		expectRejected(() =>
			db.list('asset', { where: { rendered_html: '<p>Hero shot</p>' } } as never),
		);
	});

	it('rejects a carried field nested inside a where composite', () => {
		const { db } = createServer();
		db.create('asset', assetInput() as never);
		expectRejected(() =>
			db.list('asset', {
				where: { and: [{ title: 'Hero shot' }, { or: [{ source: FILE_REFERENCE }] }] },
			} as never),
		);
	});

	it('rejects a carried field in `order`', () => {
		const { db } = createServer();
		db.create('asset', assetInput() as never);
		expectRejected(() =>
			db.list('asset', {
				order: [{ field: 'rendered_html', direction: 'ASC' }],
			} as never),
		);
	});

	it('rejects a carried field as a searched property', () => {
		const { db } = createServer();
		db.create('asset', assetInput() as never);
		expectRejected(() =>
			db.list('asset', { term: 'hero', fields: ['rendered_html'] } as never),
		);
	});

	it('never matches a carried value as a search term', () => {
		const { db } = createServer();
		db.create('asset', assetInput() as never);

		// 'blur' appears only in `meta.thumbnail_css`, which is carried.
		const carried_term = db.list('asset', { term: 'blur' } as never) as {
			count: number;
		};
		expect(carried_term.count).toBe(0);

		// The searchable sibling in the same object still matches, which proves
		// the object itself is indexed and only the carried leaf was skipped.
		const searchable_term = db.list('asset', { term: 'beach' } as never) as {
			count: number;
		};
		expect(searchable_term.count).toBe(1);
	});

	it('still returns the carried value on a query it does match', () => {
		const { db } = createServer();
		db.create('asset', assetInput() as never);
		const results = db.list('asset', { term: 'hero', sparse: true } as never) as unknown as {
			hits: { document: Record<string, unknown> }[];
		};
		expect(results.hits).toHaveLength(1);
		const [{ document }] = results.hits;
		expect(document.rendered_html).toBe('<p>Hero shot</p>');
		expect(document.source).toEqual(FILE_REFERENCE);
	});
});
