// @vitest-environment node
/**
 * File references beyond the descriptor: the `_file_gc` deletion queue, the
 * per-row `store` override, and `metadata` validation — over **real SQLite**.
 *
 * Same harness as `db.server.history.test.ts`. The queue is written inside the
 * entity write transaction, so only a real database can tell the truth about
 * what a rolled-back write leaves behind.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseServer } from './db.server';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';
import type { FileReference } from '../schema/field-types';

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

/** Two file columns with different default stores, so precedence is observable. */
const assetTable = Database.table('assets', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	cover: s.file({ store: 'MEDIA' }).optional(),
	archive: s.file({ store: 'COLD' }).optional(),
}));

/** No `file()` column at all — the queue must not even exist. */
const noteTable = Database.table('notes', (s) => ({
	id: s.primaryKey(),
	text: s.string().searchable(),
}));

/** A `file()` nested inside an `object()` — the queue must still find it. */
const bundleTable = Database.table('bundles', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	payload: s
		.object({
			label: s.string(),
			attachment: s.file({ store: 'MEDIA' }),
		})
		.optional(),
}));

const NESTED_CONFIG = { bundles: bundleTable } as unknown as Record<string, Database.Table>;

const CONFIG = { assets: assetTable, notes: noteTable } as unknown as Record<
	string,
	Database.Table
>;
const NO_FILES_CONFIG = { notes: noteTable } as unknown as Record<string, Database.Table>;

interface Fixture {
	db: DatabaseServer<Record<string, Database.Table>>;
	state: ReturnType<typeof createDurableObjectState>;
}

function createServer(config: Record<string, Database.Table> = CONFIG): Fixture {
	const state = createDurableObjectState();
	const db = new DatabaseServer(
		config as never,
		() => undefined,
		state.ctx as never,
		{ DEV: true } as never,
	) as DatabaseServer<Record<string, Database.Table>>;
	return { db, state };
}

function reference(key: string, extra: Partial<FileReference> = {}): FileReference {
	return { key, size: 12, mime: 'image/png', ...extra };
}

interface Asset {
	id: string;
	title: string;
	cover?: FileReference;
	archive?: FileReference;
}

function createAsset(fixture: Fixture, data: Record<string, unknown>): Asset {
	return fixture.db.create('assets', data as never) as unknown as Asset;
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

describe('DatabaseServer: `_file_gc` bootstrap', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	it('creates the queue and its index when a table has a `file()` column', () => {
		const columns = fixture.state.db
			.prepare(`PRAGMA table_info(_file_gc)`)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(columns).toEqual([
			'id',
			'store',
			'key',
			'entity_type',
			'entity_id',
			'deleted_at',
		]);

		const indexes = fixture.state.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '_file_gc'`,
			)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(indexes).toEqual(expect.arrayContaining(['idx__file_gc_deleted_at']));
	});

	it('does not create the queue when no table has a `file()` column', () => {
		const other = createServer(NO_FILES_CONFIG);
		const tables = other.state.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_file_gc'`,
			)
			.all();
		expect(tables).toHaveLength(0);
		expect(() => other.db.pendingFileDeletions()).toThrow(
			expect.objectContaining({ status: 400, code: 'file_gc_disabled' }) as never,
		);
		other.state.close();
	});
});

/* -------------------------------------------------------------------------- */
/* Enqueue conditions                                                         */
/* -------------------------------------------------------------------------- */

describe('DatabaseServer: file deletion queue', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	it('enqueues nothing for a create', () => {
		createAsset(fixture, { title: 'a', cover: reference('k1') });
		expect(fixture.db.pendingFileDeletions()).toEqual([]);
	});

	it('enqueues every reference a deleted row held', () => {
		const asset = createAsset(fixture, {
			title: 'a',
			cover: reference('cover-1'),
			archive: reference('archive-1'),
		});
		fixture.db.delete('assets', asset.id);

		const pending = fixture.db.pendingFileDeletions();
		expect(pending.map((row) => row.key).sort()).toEqual(['archive-1', 'cover-1']);
		expect(pending.every((row) => row.entity_type === 'assets')).toBe(true);
		expect(pending.every((row) => row.entity_id === asset.id)).toBe(true);
		expect(pending.every((row) => row.deleted_at > 0)).toBe(true);
	});

	it('enqueues nothing for a deleted row that held no reference', () => {
		const asset = createAsset(fixture, { title: 'a' });
		fixture.db.delete('assets', asset.id);
		expect(fixture.db.pendingFileDeletions()).toEqual([]);
	});

	it('enqueues the old key when an update points the field at a new object', () => {
		const asset = createAsset(fixture, { title: 'a', cover: reference('old-key') });
		fixture.db.update('assets', asset.id, { cover: reference('new-key') } as never);

		const pending = fixture.db.pendingFileDeletions();
		expect(pending).toHaveLength(1);
		expect(pending[0].key).toBe('old-key');
	});

	it('enqueues nothing when an update leaves the key alone', () => {
		const asset = createAsset(fixture, { title: 'a', cover: reference('same-key') });
		// Same object, better description — mime, name and metadata all change.
		fixture.db.update('assets', asset.id, {
			cover: reference('same-key', {
				mime: 'image/webp',
				name: 'hero.webp',
				metadata: { width: '1200' },
			}),
		} as never);
		expect(fixture.db.pendingFileDeletions()).toEqual([]);
	});

	it('enqueues nothing when an update touches only unrelated fields', () => {
		const asset = createAsset(fixture, { title: 'a', cover: reference('k1') });
		fixture.db.update('assets', asset.id, { title: 'b' } as never);
		expect(fixture.db.pendingFileDeletions()).toEqual([]);
	});

	it('enqueues nothing when an update only moves the object to another store', () => {
		// Same key, different bucket: a migration record, not an orphaning.
		const asset = createAsset(fixture, { title: 'a', cover: reference('k1') });
		fixture.db.update('assets', asset.id, {
			cover: reference('k1', { store: 'MEDIA_V2' }),
		} as never);
		expect(fixture.db.pendingFileDeletions()).toEqual([]);
	});

	it('rolls the queue back with the write that produced it', () => {
		const asset = createAsset(fixture, { title: 'a', cover: reference('doomed') });
		expect(() =>
			fixture.db.batch(() => {
				fixture.db.delete('assets', asset.id);
				throw new Error('boom');
			}),
		).toThrow('boom');
		expect(fixture.db.pendingFileDeletions()).toEqual([]);
	});

	it('returns the queue oldest-first and clamps `limit`', () => {
		for (const key of ['k1', 'k2', 'k3']) {
			const asset = createAsset(fixture, { title: key, cover: reference(key) });
			fixture.db.delete('assets', asset.id);
		}
		expect(fixture.db.pendingFileDeletions().map((row) => row.key)).toEqual([
			'k1',
			'k2',
			'k3',
		]);
		expect(fixture.db.pendingFileDeletions({ limit: 2 })).toHaveLength(2);
		expect(fixture.db.pendingFileDeletions({ limit: 99_999 })).toHaveLength(3);
	});

	it('releases one row, and is silent about an unknown id', () => {
		const asset = createAsset(fixture, { title: 'a', cover: reference('k1') });
		fixture.db.delete('assets', asset.id);
		const [pending] = fixture.db.pendingFileDeletions();

		expect(fixture.db.releaseFileDeletion(pending.id)).toBe(true);
		expect(fixture.db.pendingFileDeletions()).toEqual([]);
		// Redelivery of an already-released row must not fail a drain.
		expect(fixture.db.releaseFileDeletion(pending.id)).toBe(false);
		expect(fixture.db.releaseFileDeletion('')).toBe(false);
	});

	it('releases a whole drained page at once', () => {
		const asset = createAsset(fixture, {
			title: 'a',
			cover: reference('c'),
			archive: reference('r'),
		});
		fixture.db.delete('assets', asset.id);
		const pending = fixture.db.pendingFileDeletions();
		expect(fixture.db.releaseFileDeletions(pending.map((row) => row.id))).toBe(2);
		expect(fixture.db.pendingFileDeletions()).toEqual([]);
		expect(fixture.db.releaseFileDeletions([])).toBe(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Per-row `store` override                                                   */
/* -------------------------------------------------------------------------- */

describe('DatabaseServer: nested file references', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer(NESTED_CONFIG);
	});
	afterEach(() => fixture.state.close());

	it('records a nested `file()` at its dot path', () => {
		expect(bundleTable.config.file_fields).toHaveProperty('payload.attachment', {
			store: 'MEDIA',
		});
	});

	it('enqueues a nested reference when the row is deleted', () => {
		// A nested reference is carried (the carried tier walks nested paths), so
		// it reaches the client — it must reach the deletion queue too, or the
		// object it points at leaks silently and forever.
		const row = fixture.db.create('bundles', {
			title: 'a',
			payload: { label: 'l', attachment: { key: 'nested-1', size: 1, mime: 'image/avif' } },
		} as never) as unknown as { id: string };
		fixture.db.delete('bundles', row.id);

		const pending = fixture.db.pendingFileDeletions();
		expect(pending.map((queued) => queued.key)).toEqual(['nested-1']);
		expect(pending[0]!.store).toBe('MEDIA');
	});

	it('enqueues a nested reference whose key an update replaced', () => {
		const row = fixture.db.create('bundles', {
			title: 'a',
			payload: { label: 'l', attachment: { key: 'nested-1', size: 1, mime: 'image/avif' } },
		} as never) as unknown as { id: string };
		fixture.db.update('bundles', row.id, {
			payload: { attachment: { key: 'nested-2', size: 2, mime: 'image/avif' } },
		} as never);

		expect(fixture.db.pendingFileDeletions().map((queued) => queued.key)).toEqual(['nested-1']);
	});
});

describe('DatabaseServer: per-row file store override', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	it("records the field's default store when the reference does not override it", () => {
		const asset = createAsset(fixture, {
			title: 'a',
			cover: reference('c'),
			archive: reference('r'),
		});
		fixture.db.delete('assets', asset.id);

		const by_key = Object.fromEntries(
			fixture.db.pendingFileDeletions().map((row) => [row.key, row.store]),
		);
		expect(by_key).toEqual({ c: 'MEDIA', r: 'COLD' });
	});

	it("records the reference's own store when it overrides the default", () => {
		const asset = createAsset(fixture, {
			title: 'a',
			cover: reference('c', { store: 'TENANT_42' }),
		});
		fixture.db.delete('assets', asset.id);
		expect(fixture.db.pendingFileDeletions()[0].store).toBe('TENANT_42');
	});

	it('queues the OLD reference’s store when an update repoints the key', () => {
		// The object being orphaned lives where the *old* reference said, not
		// where the new one does.
		const asset = createAsset(fixture, {
			title: 'a',
			cover: reference('old', { store: 'OLD_BUCKET' }),
		});
		fixture.db.update('assets', asset.id, {
			cover: reference('new', { store: 'NEW_BUCKET' }),
		} as never);
		const [pending] = fixture.db.pendingFileDeletions();
		expect(pending).toMatchObject({ key: 'old', store: 'OLD_BUCKET' });
	});

	it('round-trips `store` and `metadata` through the row', () => {
		const asset = createAsset(fixture, {
			title: 'a',
			cover: reference('c', { store: 'TENANT_42', metadata: { pages: '12' } }),
		});
		const read = fixture.db.get('assets', asset.id) as unknown as Asset;
		expect(read.cover).toMatchObject({
			key: 'c',
			store: 'TENANT_42',
			metadata: { pages: '12' },
		});
	});

	it('rejects an empty `store`', () => {
		expect(() =>
			createAsset(fixture, { title: 'a', cover: reference('c', { store: '' }) }),
		).toThrow(/store/);
	});

	it('rejects a non-string `store`', () => {
		expect(() =>
			createAsset(fixture, {
				title: 'a',
				cover: reference('c', { store: 7 as unknown as string }),
			}),
		).toThrow(/store/);
	});
});

/* -------------------------------------------------------------------------- */
/* `metadata` validation                                                      */
/* -------------------------------------------------------------------------- */

describe('DatabaseServer: file reference metadata', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	function withMetadata(metadata: unknown): () => Asset {
		return () =>
			createAsset(fixture, {
				title: 'a',
				cover: reference('c', { metadata: metadata as Record<string, string> }),
			});
	}

	it('accepts an empty object and an all-string record', () => {
		expect(withMetadata({})).not.toThrow();
		expect(
			withMetadata({ pages: '12', encoding: 'h264', taken: '2024-01-01' }),
		).not.toThrow();
	});

	it('rejects a number value', () => {
		expect(withMetadata({ pages: 12 })).toThrow(/metadata\.pages/);
	});

	it('rejects a null value', () => {
		expect(withMetadata({ pages: null })).toThrow(/metadata\.pages/);
	});

	it('rejects a nested object value', () => {
		expect(withMetadata({ exif: { iso: '100' } })).toThrow(/metadata\.exif/);
	});

	it('rejects an array value', () => {
		expect(withMetadata({ tags: ['a', 'b'] })).toThrow(/metadata\.tags/);
	});

	it('rejects an array as the whole metadata object', () => {
		expect(withMetadata([])).toThrow(/plain object of string values/);
	});

	it('rejects a string as the whole metadata object', () => {
		expect(withMetadata('pages=12')).toThrow(/plain object of string values/);
	});

	it('rejects null as the whole metadata object', () => {
		expect(withMetadata(null)).toThrow(/plain object of string values/);
	});
});
