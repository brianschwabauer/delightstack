// @vitest-environment node
/**
 * DS-07 actor attribution — the trailing `{ actor }` `WriteOptions` on every
 * mutator, the `scoped(db, actor)` handle, and the `'system'` default.
 *
 * The actor is only *observable* through the DS-03 change log, so this suite
 * drives a history-enabled table over real SQLite (the same
 * `search/__tests__/sqlite_harness.ts` façade `db.server.test.ts` uses) and
 * reads the recorded `actor` back through `history()` / `changesSince()`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseServer, DEFAULT_ACTOR, scoped } from './db.server';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	}
	return { DurableObject };
});

const postTable = Database.table(
	'posts',
	(s) => ({
		id: s.primaryKey(),
		title: s.string().searchable(),
	}),
	{ history: true },
);

const CONFIG = { posts: postTable } as unknown as Record<string, Database.Table>;

interface Fixture {
	db: DatabaseServer<Record<string, Database.Table>>;
	state: ReturnType<typeof createDurableObjectState>;
}

function createServer(): Fixture {
	const state = createDurableObjectState();
	const db = new DatabaseServer(
		CONFIG as never,
		() => undefined,
		state.ctx as never,
		{ DEV: true } as never,
	) as DatabaseServer<Record<string, Database.Table>>;
	return { db, state };
}

interface Post {
	id: string;
	title: string;
}

describe('DatabaseServer: actor attribution', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	/** Every recorded actor, oldest change first. */
	function actors(): string[] {
		return fixture.db.changesSince(0).map((entry) => entry.actor);
	}

	it('exports `system` as the default actor', () => {
		expect(DEFAULT_ACTOR).toBe('system');
		expect(fixture.db.actor).toBe('system');
	});

	it('records `system` for an unattributed write', () => {
		const post = fixture.db.create('posts', { title: 'a' } as never) as unknown as Post;
		fixture.db.update('posts', post.id, { title: 'b' } as never);
		fixture.db.delete('posts', post.id);
		expect(actors()).toEqual(['system', 'system', 'system']);
	});

	it('records the `{ actor }` passed to create / update / delete', () => {
		const post = fixture.db.create('posts', { title: 'a' } as never, {
			actor: 'user:alice',
		}) as unknown as Post;
		fixture.db.update('posts', post.id, { title: 'b' } as never, {
			actor: 'agent:claude',
		});
		fixture.db.delete('posts', post.id, { actor: 'clipper' });
		expect(actors()).toEqual(['user:alice', 'agent:claude', 'clipper']);
	});

	it('records the `{ actor }` passed to transaction', () => {
		fixture.db.transaction(
			[
				{ create: { type: 'posts', data: { title: 'a' } } },
				{ create: { type: 'posts', data: { title: 'b' } } },
			],
			{ actor: 'import' },
		);
		expect(actors()).toEqual(['import', 'import']);
	});

	it('records the `{ actor }` passed to batch for every write inside it', () => {
		fixture.db.batch(
			() => {
				const post = fixture.db.create('posts', {
					title: 'a',
				} as never) as unknown as Post;
				fixture.db.update('posts', post.id, { title: 'b' } as never);
			},
			{ actor: 'migration' },
		);
		expect(actors()).toEqual(['migration', 'migration']);
	});

	it('records the `{ actor }` passed to revert', () => {
		const post = fixture.db.create('posts', { title: 'a' } as never) as unknown as Post;
		fixture.db.update('posts', post.id, { title: 'b' } as never, { actor: 'user:alice' });
		const [update_entry] = fixture.db.history('posts', post.id);

		fixture.db.revert(update_entry!.id, { actor: 'user:bob' });
		expect(fixture.db.history('posts', post.id)[0]?.actor).toBe('user:bob');
	});

	it('normalizes an empty or whitespace-only actor to `system`', () => {
		fixture.db.create('posts', { title: 'a' } as never, { actor: '' });
		fixture.db.create('posts', { title: 'b' } as never, { actor: '   ' });
		fixture.db.create('posts', { title: 'c' } as never, { actor: undefined });
		expect(actors()).toEqual(['system', 'system', 'system']);
	});

	it('trims a padded actor', () => {
		fixture.db.create('posts', { title: 'a' } as never, { actor: '  user:alice  ' });
		expect(actors()).toEqual(['user:alice']);
	});

	it('restores the previous actor after the write, including when it throws', () => {
		fixture.db.create('posts', { title: 'a' } as never, { actor: 'user:alice' });
		expect(fixture.db.actor).toBe('system');

		expect(() =>
			fixture.db.update('posts', 'does-not-exist', { title: 'x' } as never, {
				actor: 'user:bob',
			}),
		).toThrow();
		expect(fixture.db.actor).toBe('system');
	});

	it('nests actor scopes correctly', () => {
		fixture.db.batch(
			() => {
				expect(fixture.db.actor).toBe('outer');
				fixture.db.create('posts', { title: 'a' } as never, { actor: 'inner' });
				expect(fixture.db.actor).toBe('outer');
				fixture.db.create('posts', { title: 'b' } as never);
			},
			{ actor: 'outer' },
		);
		expect(fixture.db.actor).toBe('system');
		expect(actors()).toEqual(['inner', 'outer']);
	});
});

/* -------------------------------------------------------------------------- */
/* scoped()                                                                   */
/* -------------------------------------------------------------------------- */

describe('scoped()', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	function actors(): string[] {
		return fixture.db.changesSince(0).map((entry) => entry.actor);
	}

	it('exposes the resolved actor on the handle', () => {
		expect(scoped(fixture.db, 'agent:claude').actor).toBe('agent:claude');
		expect(scoped(fixture.db, '   ').actor).toBe('system');
		expect(scoped(fixture.db, '' as string).actor).toBe('system');
	});

	it('attributes create / update / delete made through the handle', () => {
		const claude = scoped(fixture.db, 'agent:claude');
		const post = claude.create('posts', { title: 'a' } as never) as unknown as Post;
		claude.update('posts', post.id, { title: 'b' } as never);
		claude.delete('posts', post.id);
		expect(actors()).toEqual(['agent:claude', 'agent:claude', 'agent:claude']);
	});

	it('attributes transaction made through the handle', () => {
		scoped(fixture.db, 'import').transaction([
			{ create: { type: 'posts', data: { title: 'a' } } },
			{ create: { type: 'posts', data: { title: 'b' } } },
		]);
		expect(actors()).toEqual(['import', 'import']);
	});

	it('attributes every write inside a handle `batch`, including bare `db` calls', () => {
		const claude = scoped(fixture.db, 'agent:claude');
		const returned = claude.batch(() => {
			// Writes go through the *unscoped* `db` here on purpose: the scope sets the
			// ambient actor, so nested calls inherit it without being re-wrapped.
			const post = fixture.db.create('posts', { title: 'a' } as never) as unknown as Post;
			fixture.db.update('posts', post.id, { title: 'b' } as never);
			return post.id;
		});
		expect(typeof returned).toBe('string');
		expect(actors()).toEqual(['agent:claude', 'agent:claude']);
	});

	it('attributes revert made through the handle', () => {
		const post = fixture.db.create('posts', { title: 'a' } as never) as unknown as Post;
		fixture.db.update('posts', post.id, { title: 'b' } as never);
		const [update_entry] = fixture.db.history('posts', post.id);

		scoped(fixture.db, 'user:bob').revert(update_entry!.id);
		expect(fixture.db.history('posts', post.id)[0]?.actor).toBe('user:bob');
	});

	it('returns the created entity unchanged', () => {
		const claude = scoped(fixture.db, 'agent:claude');
		const post = claude.create('posts', { title: 'a' } as never) as unknown as Post;
		expect(post).toMatchObject({ id: expect.any(String), title: 'a' });
		expect(fixture.db.get('posts', post.id)).toMatchObject({ title: 'a' });
	});

	it('does not leak its actor onto writes made outside the handle', () => {
		const claude = scoped(fixture.db, 'agent:claude');
		claude.create('posts', { title: 'a' } as never);
		fixture.db.create('posts', { title: 'b' } as never);
		expect(actors()).toEqual(['agent:claude', 'system']);
	});
});
