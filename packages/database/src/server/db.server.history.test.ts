// @vitest-environment node
/**
 * The DS-03 change log — `_change_log`, `history()`, `changesSince()`,
 * `revert()` and the retention sweeper — over **real SQLite**.
 *
 * Same harness as `db.server.test.ts`: the production `DatabaseServer` runs
 * against `node:sqlite` through the `DurableObjectState` façade in
 * `search/__tests__/sqlite_harness.ts`. History is written inside the entity
 * write transaction, so nothing short of a real database can tell the truth
 * about rollback behaviour.
 *
 * Tests named `BUG:` document defects found while writing this suite. They are
 * expected to FAIL until the driver is fixed — see the file's closing block.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOB_OMITTED, DatabaseServer, scoped, type ChangeLogEntry } from './db.server';
import { Database } from '../schema/schema';
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

/** History on, default retention (365 days). */
const postTable = Database.table(
	'posts',
	(s) => ({
		id: s.primaryKey(),
		title: s.string().searchable(),
		body: s.string().searchable().optional(),
		views: s.number().optional(),
		owner_id: s.string().readonly().optional(),
		meta: s
			.object({
				pinned: s.boolean().optional(),
			})
			.optional(),
	}),
	{ history: true },
);

/** History deliberately NOT enabled. */
const commentTable = Database.table('comments', (s) => ({
	id: s.primaryKey(),
	text: s.string().searchable(),
}));

const CONFIG = { posts: postTable, comments: commentTable } as unknown as Record<
	string,
	Database.Table
>;

/** No table opts into history at all — `history()` must refuse. */
const NO_HISTORY_CONFIG = { comments: commentTable } as unknown as Record<
	string,
	Database.Table
>;

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

interface Post {
	id: string;
	title: string;
	body?: string;
	views?: number;
	owner_id?: string;
	created_at: number;
	updated_at: number;
}

function createPost(fixture: Fixture, data: Record<string, unknown>): Post {
	return fixture.db.create('posts', data as never) as unknown as Post;
}

/** The ids currently in `posts`, read straight from SQLite. */
function postIds(fixture: Fixture): string[] {
	return (
		fixture.state.db.prepare(`SELECT id FROM posts ORDER BY created_at ASC`).all() as {
			id: string;
		}[]
	).map((row) => row.id);
}

/** Raw `_change_log` rows, so a test can assert the stored shape, not the parsed one. */
function rawChangeRows(fixture: Fixture): Record<string, unknown>[] {
	return fixture.state.db
		.prepare(`SELECT * FROM _change_log ORDER BY created_at ASC, id ASC`)
		.all() as unknown as Record<string, unknown>[];
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

describe('DatabaseServer: change log recording', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	it('creates the `_change_log` table and its indexes when a table opts in', () => {
		const columns = fixture.state.db
			.prepare(`PRAGMA table_info(_change_log)`)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(columns).toEqual([
			'id',
			'table',
			'entity_id',
			'operation',
			'actor',
			'operation_id',
			'patch_json',
			'previous_json',
			'created_at',
		]);

		const indexes = fixture.state.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '_change_log'`,
			)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(indexes).toEqual(
			expect.arrayContaining([
				'idx__change_log_entity',
				'idx__change_log_created_at',
				'idx__change_log_operation',
			]),
		);
	});

	it('does not create `_change_log` when nothing opts in', () => {
		const other = createServer(NO_HISTORY_CONFIG);
		const tables = other.state.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_change_log'`,
			)
			.all();
		expect(tables).toHaveLength(0);
		other.state.close();
	});

	it('records a create with the full entity as `patch` and no `previous`', () => {
		const post = createPost(fixture, { title: 'Hello', body: 'World' });
		const [entry, ...rest] = fixture.db.history('posts', post.id);
		expect(rest).toHaveLength(0);
		expect(entry).toEqual<ChangeLogEntry>({
			id: expect.any(String),
			table: 'posts',
			entity_id: post.id,
			operation: 'create',
			actor: 'system',
			patch: expect.objectContaining({
				id: post.id,
				title: 'Hello',
				body: 'World',
				created_at: post.created_at,
			}),
			previous: undefined,
			created_at: expect.any(Number),
		});
	});

	it('stores `previous_json` as NULL for a create', () => {
		createPost(fixture, { title: 'Hello' });
		const [row] = rawChangeRows(fixture);
		expect(row?.previous_json).toBeNull();
		expect(typeof row?.patch_json).toBe('string');
	});

	it('records an update with only the fields that actually changed', () => {
		const post = createPost(fixture, { title: 'Old', body: 'Body', views: 1 });
		fixture.db.update('posts', post.id, { title: 'New' } as never);

		const [entry] = fixture.db.history('posts', post.id);
		expect(entry?.operation).toBe('update');
		expect(entry?.patch).toEqual({ title: 'New' });
		expect(entry?.previous).toEqual({ title: 'Old' });
	});

	it('excludes `updated_at` from a recorded update diff', () => {
		const post = createPost(fixture, { title: 'Old' });
		const updated = fixture.db.update('posts', post.id, {
			title: 'New',
		} as never) as unknown as Post;
		// The write really did bump it — the diff just must not mention it.
		expect(updated.updated_at).toBeGreaterThan(post.updated_at);

		const [entry] = fixture.db.history('posts', post.id);
		expect(Object.keys(entry?.patch ?? {})).toEqual(['title']);
		expect(entry?.patch).not.toHaveProperty('updated_at');
		expect(entry?.previous).not.toHaveProperty('updated_at');
	});

	it('writes no change row for a no-op update', () => {
		const post = createPost(fixture, { title: 'Same' });
		expect(fixture.db.history('posts', post.id)).toHaveLength(1);

		fixture.db.update('posts', post.id, { title: 'Same' } as never);
		const entries = fixture.db.history('posts', post.id);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.operation).toBe('create');
	});

	it('records a delete with the full entity as `previous` and no `patch`', () => {
		const post = createPost(fixture, { title: 'Doomed', body: 'Bye' });
		fixture.db.delete('posts', post.id);

		const [entry] = fixture.db.history('posts', post.id);
		expect(entry?.operation).toBe('delete');
		expect(entry?.patch).toBeUndefined();
		expect(entry?.previous).toEqual(
			expect.objectContaining({ id: post.id, title: 'Doomed', body: 'Bye' }),
		);
	});

	it('records nothing for a table that did not opt in', () => {
		const comment = fixture.db.create('comments', {
			text: 'hi',
		} as never) as unknown as { id: string };
		fixture.db.update('comments', comment.id, { text: 'edited' } as never);
		fixture.db.delete('comments', comment.id);

		expect(fixture.db.history('comments', comment.id)).toEqual([]);
		expect(rawChangeRows(fixture)).toHaveLength(0);
	});

	it('throws `history_disabled` when no table has history enabled', () => {
		const other = createServer(NO_HISTORY_CONFIG);
		expect(() => other.db.history('comments', 'x')).toThrow(
			expect.objectContaining({ status: 400, code: 'history_disabled' }),
		);
		expect(() => other.db.changesSince(0)).toThrow(
			expect.objectContaining({ status: 400, code: 'history_disabled' }),
		);
		expect(() => other.db.revert('anything')).toThrow(
			expect.objectContaining({ status: 400, code: 'history_disabled' }),
		);
		other.state.close();
	});

	it('leaves no change row behind when the write transaction rolls back', () => {
		expect(() =>
			fixture.db.transaction([
				{ create: { type: 'posts', data: { title: 'Doomed' } } },
				{ update: { type: 'posts', id: 'does-not-exist', data: { title: 'x' } } },
			]),
		).toThrow();

		expect(rawChangeRows(fixture)).toHaveLength(0);
		expect(fixture.db.list('posts', {} as never).count).toBe(0);
	});

	it('records one row per operation in a multi-op transaction', () => {
		const results = fixture.db.transaction([
			{ create: { type: 'posts', data: { title: 'A' } } },
			{ create: { type: 'posts', data: { title: 'B' } } },
		]);
		expect(results).toHaveLength(2);
		expect(rawChangeRows(fixture)).toHaveLength(2);
	});

	it('throws 404 when reverting an unknown change id', () => {
		expect(() => fixture.db.revert('no-such-change')).toThrow(
			expect.objectContaining({ status: 404 }),
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Reading — history() / changesSince()                                       */
/* -------------------------------------------------------------------------- */

describe('DatabaseServer: history() and changesSince()', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	it('returns an entity’s changes newest first', () => {
		const post = createPost(fixture, { title: 'v1' });
		fixture.db.update('posts', post.id, { title: 'v2' } as never);
		fixture.db.update('posts', post.id, { title: 'v3' } as never);

		const entries = fixture.db.history('posts', post.id);
		expect(entries.map((entry) => entry.operation)).toEqual([
			'update',
			'update',
			'create',
		]);
		expect(entries[0]?.patch).toEqual({ title: 'v3' });
		expect(entries[1]?.patch).toEqual({ title: 'v2' });
	});

	it('scopes history to one entity', () => {
		const first = createPost(fixture, { title: 'first' });
		createPost(fixture, { title: 'second' });
		expect(fixture.db.history('posts', first.id)).toHaveLength(1);
		expect(fixture.db.changesSince(0)).toHaveLength(2);
	});

	it('defaults `limit` to 50 and clamps it to 1000', () => {
		const post = createPost(fixture, { title: 'v0' });
		for (let index = 1; index <= 60; index++) {
			fixture.db.update('posts', post.id, { title: `v${index}` } as never);
		}
		expect(fixture.db.history('posts', post.id)).toHaveLength(50);
		expect(fixture.db.history('posts', post.id, { limit: 10 })).toHaveLength(10);
		// 61 rows exist; a limit beyond the clamp still returns everything there is.
		expect(fixture.db.history('posts', post.id, { limit: 100_000 })).toHaveLength(61);
		// A zero/negative limit falls back to the default rather than returning nothing.
		expect(fixture.db.history('posts', post.id, { limit: 0 })).toHaveLength(50);
		expect(fixture.db.history('posts', post.id, { limit: -5 })).toHaveLength(1);
	});

	it('pages backwards with `before`', () => {
		const post = createPost(fixture, { title: 'v0' });
		fixture.db.update('posts', post.id, { title: 'v1' } as never);
		fixture.db.update('posts', post.id, { title: 'v2' } as never);

		const first_page = fixture.db.history('posts', post.id, { limit: 2 });
		expect(first_page).toHaveLength(2);
		const oldest = first_page[first_page.length - 1]!;

		const second_page = fixture.db.history('posts', post.id, {
			before: oldest.created_at,
		});
		expect(second_page.every((entry) => entry.created_at < oldest.created_at)).toBe(true);
		expect(second_page.map((entry) => entry.id)).not.toContain(oldest.id);
	});

	it('returns changes oldest first from `changesSince`', () => {
		const post = createPost(fixture, { title: 'v0' });
		fixture.db.update('posts', post.id, { title: 'v1' } as never);
		fixture.db.delete('posts', post.id);

		const entries = fixture.db.changesSince(0);
		expect(entries.map((entry) => entry.operation)).toEqual([
			'create',
			'update',
			'delete',
		]);
		const timestamps = entries.map((entry) => entry.created_at);
		expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
	});

	it('honours the `timestamp` cursor', () => {
		const post = createPost(fixture, { title: 'v0' });
		const [create_entry] = fixture.db.history('posts', post.id);
		fixture.db.update('posts', post.id, { title: 'v1' } as never);

		const later = fixture.db.changesSince(create_entry!.created_at + 1);
		expect(later.map((entry) => entry.operation)).toEqual(['update']);
		// The boundary is inclusive.
		expect(fixture.db.changesSince(create_entry!.created_at)).toHaveLength(2);
		// A negative/NaN timestamp is treated as "from the beginning".
		expect(fixture.db.changesSince(-1)).toHaveLength(2);
		expect(fixture.db.changesSince(Number.NaN)).toHaveLength(2);
	});

	it('narrows `changesSince` to one table', () => {
		const post = createPost(fixture, { title: 'a' });
		fixture.db.create('comments', { text: 'ignored' } as never);
		expect(fixture.db.changesSince(0, { table: 'posts' })).toHaveLength(1);
		expect(fixture.db.changesSince(0, { table: 'posts' })[0]?.entity_id).toBe(post.id);
		expect(fixture.db.changesSince(0, { table: 'comments' })).toEqual([]);
	});

	it('defaults `changesSince` limit to 500 and clamps it', () => {
		const post = createPost(fixture, { title: 'v0' });
		for (let index = 1; index <= 5; index++) {
			fixture.db.update('posts', post.id, { title: `v${index}` } as never);
		}
		expect(fixture.db.changesSince(0, { limit: 2 })).toHaveLength(2);
		expect(fixture.db.changesSince(0, { limit: 0 })).toHaveLength(6);
		expect(fixture.db.changesSince(0, { limit: 10_000 })).toHaveLength(6);
	});
});

/* -------------------------------------------------------------------------- */
/* revert()                                                                   */
/* -------------------------------------------------------------------------- */

describe('DatabaseServer: revert()', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	it('reverts a create by deleting the entity', () => {
		const post = createPost(fixture, { title: 'Oops' });
		const [create_entry] = fixture.db.history('posts', post.id);

		expect(fixture.db.revert(create_entry!.id)).toBeUndefined();
		expect(() => fixture.db.get('posts', post.id)).toThrow(
			expect.objectContaining({ status: 404 }),
		);
	});

	it('reverts an update by restoring exactly the fields it changed', () => {
		const post = createPost(fixture, { title: 'Old', body: 'Kept' });
		fixture.db.update('posts', post.id, { title: 'New' } as never);
		const [update_entry] = fixture.db.history('posts', post.id);

		const reverted = fixture.db.revert(update_entry!.id) as unknown as Post;
		expect(reverted.title).toBe('Old');
		expect(reverted.body).toBe('Kept');
		expect((fixture.db.get('posts', post.id) as unknown as Post).title).toBe('Old');
	});

	it('reverts a delete, recreating the row with its original id and created_at', () => {
		const post = createPost(fixture, { title: 'Gone', body: 'Text' });
		fixture.db.delete('posts', post.id);
		const [delete_entry] = fixture.db.history('posts', post.id);

		const restored = fixture.db.revert(delete_entry!.id) as unknown as Post;
		expect(restored.id).toBe(post.id);
		expect(restored.created_at).toBe(post.created_at);
		expect(restored.title).toBe('Gone');
		expect(restored.body).toBe('Text');
		expect(fixture.db.get('posts', post.id)).toMatchObject({ title: 'Gone' });
	});

	it('records the revert itself as a new change', () => {
		const post = createPost(fixture, { title: 'Old' });
		fixture.db.update('posts', post.id, { title: 'New' } as never);
		const before = fixture.db.history('posts', post.id);
		expect(before).toHaveLength(2);

		fixture.db.revert(before[0]!.id);

		const after = fixture.db.history('posts', post.id);
		expect(after).toHaveLength(3);
		expect(after[0]?.operation).toBe('update');
		expect(after[0]?.patch).toEqual({ title: 'Old' });
		expect(after[0]?.previous).toEqual({ title: 'New' });
		// History is append-only: the original entry is untouched.
		expect(after.map((entry) => entry.id)).toEqual(
			expect.arrayContaining(before.map((entry) => entry.id)),
		);
	});

	it('reverts a revert', () => {
		const post = createPost(fixture, { title: 'Old' });
		fixture.db.update('posts', post.id, { title: 'New' } as never);
		const [update_entry] = fixture.db.history('posts', post.id);
		fixture.db.revert(update_entry!.id);
		const [revert_entry] = fixture.db.history('posts', post.id);

		fixture.db.revert(revert_entry!.id);
		expect((fixture.db.get('posts', post.id) as unknown as Post).title).toBe('New');
	});

	it('rejects a revert for an entity type that is no longer configured', () => {
		const post = createPost(fixture, { title: 'a' });
		const [entry] = fixture.db.history('posts', post.id);
		fixture.state.db
			.prepare(`UPDATE _change_log SET "table" = 'not_a_table' WHERE id = ?`)
			.run(entry!.id);
		expect(() => fixture.db.revert(entry!.id)).toThrow(
			expect.objectContaining({ status: 400 }),
		);
	});

	/* ---------------------------------------------------------------------- */
	/* Known defects                                                          */
	/* ---------------------------------------------------------------------- */

	it('records clearing a field with null, and reverts it', () => {
		// `update()`'s deep merge treats `undefined` as "leave alone" and `null` as
		// "clear" — which is what makes an explicit null round-trip through the log
		// while the `undefined` case below cannot.
		const post = createPost(fixture, { title: 'a', body: 'text' });
		fixture.db.update('posts', post.id, { body: null } as never);
		expect((fixture.db.get('posts', post.id) as unknown as Post).body).toBeUndefined();

		const [update_entry] = fixture.db.history('posts', post.id);
		expect(update_entry?.previous).toEqual({ body: 'text' });

		fixture.db.revert(update_entry!.id);
		expect((fixture.db.get('posts', post.id) as unknown as Post).body).toBe('text');
	});

	it('BUG: revert of an update cannot clear a field back to unset', () => {
		// `body` starts unset, so the update's `previous` is `{ body: undefined }` —
		// which `JSON.stringify` drops entirely. The reverting `update()` therefore
		// receives `{}` (and even if it did receive `undefined`, the deep merge
		// treats `undefined` as "leave alone"), so the field can never go back.
		const post = createPost(fixture, { title: 'Titled' });
		expect((fixture.db.get('posts', post.id) as unknown as Post).body).toBeUndefined();

		fixture.db.update('posts', post.id, { body: 'added' } as never);
		const [update_entry] = fixture.db.history('posts', post.id);
		expect(update_entry?.patch).toEqual({ body: 'added' });

		fixture.db.revert(update_entry!.id);
		expect((fixture.db.get('posts', post.id) as unknown as Post).body).toBeUndefined();
	});

	it('BUG: revert of an update does not restore a readonly field', () => {
		// `update()` strips every `readonly_fields` entry from the incoming data, and
		// `revert()` is built on `update()` — so a change whose `previous` names a
		// readonly column silently reverts nothing for that column. The change row is
		// written directly here because the strip also prevents `update()` from ever
		// producing one, which is precisely why the defect went unnoticed.
		const post = createPost(fixture, { title: 'a', owner_id: 'alice' });
		fixture.state.db
			.prepare(`UPDATE posts SET owner_id = 'mallory' WHERE id = ?`)
			.run(post.id);
		fixture.state.db
			.prepare(
				`INSERT INTO _change_log (id, "table", entity_id, operation, actor, patch_json, previous_json, created_at) VALUES (?, 'posts', ?, 'update', 'system', ?, ?, ?)`,
			)
			.run(
				'synthetic-readonly-change',
				post.id,
				JSON.stringify({ owner_id: 'mallory' }),
				JSON.stringify({ owner_id: 'alice' }),
				Date.now(),
			);

		fixture.db.revert('synthetic-readonly-change');
		expect((fixture.db.get('posts', post.id) as unknown as Post).owner_id).toBe('alice');
	});

	it('BUG: reverting a delete onto a live id raises a raw SQLite error, not a DelightError', () => {
		// `revert()` of a delete runs a `preserve_id` create with no existence check.
		// Reverting the same delete twice (or reverting after the row came back some
		// other way) therefore surfaces SQLite's UNIQUE constraint failure verbatim
		// instead of a 409 `DelightError`.
		const post = createPost(fixture, { title: 'Gone' });
		fixture.db.delete('posts', post.id);
		const [delete_entry] = fixture.db.history('posts', post.id);

		fixture.db.revert(delete_entry!.id);
		expect(() => fixture.db.revert(delete_entry!.id)).toThrow(
			expect.objectContaining({ status: 409 }),
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Blob columns                                                               */
/* -------------------------------------------------------------------------- */

const snapshotTable = Database.table(
	'snapshots',
	(s) => ({
		id: s.primaryKey(),
		label: s.string().searchable(),
		bytes: s.blob({ max_bytes: 1_000_000 }),
	}),
	{ history: true },
);

/** The same shape with an optional blob — where the loss is silent rather than fatal. */
const draftTable = Database.table(
	'drafts',
	(s) => ({
		id: s.primaryKey(),
		label: s.string().searchable(),
		bytes: s.blob({ max_bytes: 1_000_000 }).optional(),
	}),
	{ history: true },
);

const BLOB_CONFIG = { snapshots: snapshotTable, drafts: draftTable } as unknown as Record<
	string,
	Database.Table
>;

describe('DatabaseServer: change log and blob columns', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer(BLOB_CONFIG);
	});
	afterEach(() => fixture.state.close());

	it('records a marker instead of blob bytes', () => {
		// Not the bytes: `JSON.stringify(new Uint8Array([1,2]))` is `{"0":1,"1":2}`,
		// so recording them would make the log larger than the table and blow past
		// the 2MB per-value ceiling. A marker rather than a deleted key, so
		// `revert()` can tell "bytes we did not keep" from "column was empty".
		const created = fixture.db.create('snapshots', {
			label: 'first',
			bytes: new Uint8Array([1, 2, 3]),
		} as never) as unknown as { id: string };

		const [entry] = fixture.db.history('snapshots', created.id);
		expect(entry?.patch).toHaveProperty('label', 'first');
		expect(entry?.patch?.bytes).toEqual({ [BLOB_OMITTED]: true });
	});

	it('refuses to revert a delete that would drop blob bytes', () => {
		// The bytes were never recorded, so the row cannot be put back intact.
		// Refuse loudly rather than restore a quietly incomplete row.
		const created = fixture.db.create('snapshots', {
			label: 'first',
			bytes: new Uint8Array([1, 2, 3]),
		} as never) as unknown as { id: string };
		fixture.db.delete('snapshots', created.id);
		const [delete_entry] = fixture.db.history('snapshots', created.id);

		expect(() => fixture.db.revert(delete_entry!.id)).toThrow(DelightError);
		try {
			fixture.db.revert(delete_entry!.id);
		} catch (error) {
			expect((error as DelightError).status).toBe(409);
			expect((error as DelightError).code).toBe('blob_not_recoverable');
			expect((error as DelightError).message).toContain("'bytes'");
		}
	});

	it('restores everything but the blob under { without_blobs: true }', () => {
		// The opt-in. `bytes` is optional on `drafts`, so the row comes back
		// without it — but only because the caller asked for exactly that.
		const created = fixture.db.create('drafts', {
			label: 'first',
			bytes: new Uint8Array([9, 8, 7]),
		} as never) as unknown as { id: string };
		fixture.db.delete('drafts', created.id);
		const [delete_entry] = fixture.db.history('drafts', created.id);

		const restored = fixture.db.revert(delete_entry!.id, { without_blobs: true }) as unknown as {
			id: string;
			label: string;
			bytes?: Uint8Array;
		};
		expect(restored.id).toBe(created.id);
		expect(restored.label).toBe('first');
		expect(restored.bytes).toBeUndefined();
	});

	it('still refuses under { without_blobs: true } when the blob is required', () => {
		// `snapshots.bytes` is required, so there is no incomplete row to restore
		// — the opt-in cannot rescue this one and validation says so.
		const created = fixture.db.create('snapshots', {
			label: 'first',
			bytes: new Uint8Array([1, 2, 3]),
		} as never) as unknown as { id: string };
		fixture.db.delete('snapshots', created.id);
		const [delete_entry] = fixture.db.history('snapshots', created.id);

		expect(() => fixture.db.revert(delete_entry!.id, { without_blobs: true })).toThrow(
			/required/i,
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Retention                                                                  */
/* -------------------------------------------------------------------------- */

const shortTable = Database.table(
	'shorts',
	(s) => ({ id: s.primaryKey(), title: s.string().searchable() }),
	{ history: true, history_retention_days: 30 },
);

const foreverTable = Database.table(
	'forevers',
	(s) => ({ id: s.primaryKey(), title: s.string().searchable() }),
	{ history: true, history_retention_days: 0 },
);

const RETENTION_CONFIG = {
	shorts: shortTable,
	forevers: foreverTable,
} as unknown as Record<string, Database.Table>;

const DAY_MS = 24 * 60 * 60 * 1000;

describe('DatabaseServer: change log retention', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer(RETENTION_CONFIG);
	});
	afterEach(() => fixture.state.close());

	/** Backdate every recorded change for a table, as if it had happened days ago. */
	function backdate(table: string, days: number): void {
		fixture.state.db
			.prepare(`UPDATE _change_log SET created_at = ? WHERE "table" = ?`)
			.run(Date.now() - days * DAY_MS, table);
	}

	it('arms a retention alarm at boot', () => {
		expect(fixture.state.alarm()).toEqual(expect.any(Number));
	});

	it('deletes rows past `history_retention_days`', async () => {
		const short = fixture.db.create('shorts', {
			title: 'old',
		} as never) as unknown as { id: string };
		backdate('shorts', 60);
		const fresh = fixture.db.create('shorts', {
			title: 'new',
		} as never) as unknown as { id: string };

		await fixture.db.alarm();

		expect(fixture.db.history('shorts', short.id)).toEqual([]);
		expect(fixture.db.history('shorts', fresh.id)).toHaveLength(1);
	});

	it('keeps rows inside the window', async () => {
		const short = fixture.db.create('shorts', {
			title: 'recent',
		} as never) as unknown as { id: string };
		backdate('shorts', 29);

		await fixture.db.alarm();
		expect(fixture.db.history('shorts', short.id)).toHaveLength(1);
	});

	it('keeps history forever when `history_retention_days` is 0', async () => {
		const forever = fixture.db.create('forevers', {
			title: 'ancient',
		} as never) as unknown as { id: string };
		backdate('forevers', 10_000);

		await fixture.db.alarm();
		expect(fixture.db.history('forevers', forever.id)).toHaveLength(1);
	});

	it('re-arms the alarm after a sweep', async () => {
		fixture.db.create('shorts', { title: 'old' } as never);
		backdate('shorts', 60);
		await fixture.db.alarm();
		expect(fixture.state.alarm()).toEqual(expect.any(Number));
	});

	it('rejects a negative `history_retention_days` at config time', () => {
		expect(() =>
			Database.table('bad', (s) => ({ id: s.primaryKey(), title: s.string() }), {
				history: true,
				history_retention_days: -1,
			}),
		).toThrow();
	});
});

/* -------------------------------------------------------------------------- */
/* Batch grouping, operationChanges() and revertOperation()                           */
/* -------------------------------------------------------------------------- */

describe('DatabaseServer: change operations', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	it('records the `{ operation }` write option on every change the write produces', () => {
		const post = createPost(fixture, { title: 'a' });
		fixture.db.update('posts', post.id, { title: 'b' } as never, { operation: 'import-1' });
		const [row] = rawChangeRows(fixture).filter((r) => r.operation === 'update');
		expect(row.operation_id).toBe('import-1');
		const [entry] = fixture.db.history('posts', post.id);
		expect(entry.operation_id).toBe('import-1');
	});

	it('a partial `{ operation }` keeps the surrounding actor', () => {
		// Each field of the write scope inherits independently. Resetting the
		// unspecified one silently re-attributed the write to 'system', which is
		// exactly the attribution the actor feature exists to record.
		const post = createPost(fixture, { title: 'a' });
		fixture.db.batch(
			() => {
				fixture.db.update('posts', post.id, { title: 'b' } as never, { operation: 'op-1' });
			},
			{ actor: 'agent:claude' },
		);
		const [entry] = fixture.db.history('posts', post.id);
		expect(entry.actor).toBe('agent:claude');
		expect(entry.operation_id).toBe('op-1');
	});

	it('a partial `{ actor }` keeps the surrounding operation', () => {
		const post = createPost(fixture, { title: 'a' });
		fixture.db.batch(
			() => {
				fixture.db.update('posts', post.id, { title: 'b' } as never, { actor: 'user:brian' });
			},
			{ operation: 'op-2' },
		);
		const [entry] = fixture.db.history('posts', post.id);
		expect(entry.actor).toBe('user:brian');
		expect(entry.operation_id).toBe('op-2');
	});

	it('leaves `operation_id` undefined for an ungrouped write', () => {
		const post = createPost(fixture, { title: 'a' });
		const [entry] = fixture.db.history('posts', post.id);
		expect(entry.operation_id).toBeUndefined();
	});

	it('treats a blank or whitespace-only operation as absent', () => {
		const post = createPost(fixture, { title: 'a' }); // ungrouped create
		fixture.db.update('posts', post.id, { title: 'b' } as never, { operation: '   ' });
		const [entry] = fixture.db.history('posts', post.id);
		expect(entry.operation_id).toBeUndefined();
	});

	it('applies the operation through `scoped(db, actor, operation)`, actor included', () => {
		const importer = scoped(fixture.db, 'import', 'run-7');
		expect(importer.actor).toBe('import');
		expect(importer.operation_id).toBe('run-7');
		importer.create('posts', { title: 'a' } as never);
		const [row] = rawChangeRows(fixture);
		expect(row.actor).toBe('import');
		expect(row.operation_id).toBe('run-7');
	});

	it('applies a scoped operation to bare-`db` writes inside its `batch()`', () => {
		const importer = scoped(fixture.db, 'import', 'run-8');
		importer.batch(() => {
			fixture.db.create('posts', { title: 'inside' } as never);
		});
		const [row] = rawChangeRows(fixture);
		expect(row.operation_id).toBe('run-8');
		expect(row.actor).toBe('import');
	});

	it('reports the running operation on `db.operation_id`, and restores it after', () => {
		expect(fixture.db.operation_id).toBeUndefined();
		fixture.db.batch(
			() => {
				expect(fixture.db.operation_id).toBe('run-9');
			},
			{ operation: 'run-9' },
		);
		expect(fixture.db.operation_id).toBeUndefined();
	});

	it('returns an operation oldest-first from `operationChanges()`', () => {
		const importer = scoped(fixture.db, 'import', 'run-10');
		const first = importer.create('posts', { title: 'first' } as never) as unknown as Post;
		importer.update('posts', first.id, { title: 'second' } as never);
		createPost(fixture, { title: 'unrelated' });

		const entries = fixture.db.operationChanges('run-10');
		expect(entries.map((e) => e.operation)).toEqual(['create', 'update']);
		expect(entries.every((e) => e.operation_id === 'run-10')).toBe(true);
	});

	it('returns an empty array from `operationChanges()` for an unknown operation', () => {
		createPost(fixture, { title: 'a' });
		expect(fixture.db.operationChanges('nope')).toEqual([]);
		expect(fixture.db.operationChanges('')).toEqual([]);
	});

	it('narrows `changesSince()` by operation, and by operation and table together', () => {
		const importer = scoped(fixture.db, 'import', 'run-11');
		importer.create('posts', { title: 'grouped' } as never);
		createPost(fixture, { title: 'loose' });

		const grouped = fixture.db.changesSince(0, { operation: 'run-11' });
		expect(grouped).toHaveLength(1);
		expect((grouped[0].patch as { title: string }).title).toBe('grouped');
		expect(fixture.db.changesSince(0, { operation: 'run-11', table: 'posts' })).toHaveLength(1);
		expect(fixture.db.changesSince(0, { operation: 'run-11', table: 'comments' })).toHaveLength(0);
		expect(fixture.db.changesSince(0)).toHaveLength(2);
	});

	it('undoes a whole operation and reports how many changes it reverted', () => {
		const importer = scoped(fixture.db, 'import', 'run-12');
		importer.create('posts', { title: 'one' } as never);
		importer.create('posts', { title: 'two' } as never);
		const kept = createPost(fixture, { title: 'kept' });

		expect(fixture.db.revertOperation('run-12')).toBe(2);
		expect(postIds(fixture)).toEqual([kept.id]);
	});

	it('reverts in REVERSE chronological order — an update before the create it followed', () => {
		// The whole point of the ordering guarantee: undoing the create first
		// would delete the row, and the update's revert would then 404.
		const importer = scoped(fixture.db, 'import', 'run-13');
		const post = importer.create('posts', { title: 'draft' } as never) as unknown as Post;
		importer.update('posts', post.id, { title: 'published' } as never);

		expect(fixture.db.revertOperation('run-13')).toBe(2);
		expect(postIds(fixture)).toEqual([]);

		// And it really walked backwards: the revert log reads update-then-create.
		const reverts = fixture.db
			.changesSince(0)
			.filter((entry) => entry.operation_id && entry.operation_id !== 'run-13');
		expect(reverts.map((entry) => entry.operation)).toEqual(['update', 'delete']);
	});

	it('restores an operation that deleted a row, in the right order', () => {
		const post = createPost(fixture, { title: 'original' });
		const agent = scoped(fixture.db, 'agent:claude', 'run-14');
		agent.update('posts', post.id, { title: 'rewritten' } as never);
		agent.delete('posts', post.id);

		expect(fixture.db.revertOperation('run-14')).toBe(2);
		// Delete undone first (row comes back as 'rewritten'), then the update
		// undone (back to 'original'). Either other order loses the row.
		expect((fixture.db.get('posts', post.id) as unknown as Post).title).toBe('original');
	});

	it('is atomic: one failing revert rolls back the whole operation', () => {
		const importer = scoped(fixture.db, 'import', 'run-15');
		const post = importer.create('posts', { title: 'one' } as never) as unknown as Post;
		const other = importer.create('posts', { title: 'two' } as never) as unknown as Post;

		// Break the newest change in the operation so its revert throws: `revert()`
		// refuses a change whose table is no longer in the config.
		fixture.state.db
			.prepare(`UPDATE _change_log SET "table" = 'gone' WHERE entity_id = ?`)
			.run(other.id);

		expect(() => fixture.db.revertOperation('run-15')).toThrow(DelightError);
		// Nothing was undone — not even the change that would have succeeded.
		expect(postIds(fixture).sort()).toEqual([post.id, other.id].sort());
		expect(fixture.db.changesSince(0).filter((e) => e.operation === 'delete')).toHaveLength(0);
	});

	it('records its own reverts under a new operation id, which is itself revertible', () => {
		const importer = scoped(fixture.db, 'import', 'run-16');
		const post = importer.create('posts', { title: 'imported' } as never) as unknown as Post;

		fixture.db.revertOperation('run-16', { operation: 'undo-16' });
		expect(postIds(fixture)).toEqual([]);

		const undo = fixture.db.operationChanges('undo-16');
		expect(undo).toHaveLength(1);
		expect(undo[0].operation).toBe('delete');

		// Redo: reverting the undo puts the row back with its original id.
		expect(fixture.db.revertOperation('undo-16')).toBe(1);
		expect((fixture.db.get('posts', post.id) as unknown as Post).title).toBe('imported');
	});

	it('generates an operation id for its reverts when the caller supplies none', () => {
		const importer = scoped(fixture.db, 'import', 'run-17');
		importer.create('posts', { title: 'a' } as never);
		fixture.db.revertOperation('run-17');

		const generated = fixture.db
			.changesSince(0)
			.filter((entry) => entry.operation_id && entry.operation_id !== 'run-17');
		expect(generated).toHaveLength(1);
		expect(generated[0].operation_id).toEqual(expect.any(String));
	});

	it('attributes reverts to the actor passed to `revertOperation()`', () => {
		const importer = scoped(fixture.db, 'import', 'run-18');
		importer.create('posts', { title: 'a' } as never);
		fixture.db.revertOperation('run-18', { actor: 'user:bob', operation: 'undo-18' });
		expect(fixture.db.operationChanges('undo-18')[0].actor).toBe('user:bob');
	});

	it('throws 404 for an unknown or blank operation id', () => {
		createPost(fixture, { title: 'a' });
		expect(() => fixture.db.revertOperation('never-existed')).toThrow(
			expect.objectContaining({ status: 404, code: 'operation_not_found' }) as never,
		);
		expect(() => fixture.db.revertOperation('  ')).toThrow(
			expect.objectContaining({ status: 404 }) as never,
		);
	});
});
