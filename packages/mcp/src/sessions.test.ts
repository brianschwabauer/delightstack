import { describe, expect, it, vi } from 'vitest';
import { createMemorySessionStore, generateSessionId } from './sessions.js';
import type { McpSession } from './types.js';

function session(overrides?: Partial<McpSession>): McpSession {
	const now = Date.now();
	return {
		id: generateSessionId(),
		protocol_version: '2025-06-18',
		created_at: now,
		last_seen_at: now,
		...overrides,
	};
}

describe('generateSessionId', () => {
	it('is unguessable and header-safe', () => {
		const ids = new Set(Array.from({ length: 200 }, generateSessionId));
		expect(ids.size).toBe(200);
		for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe('createMemorySessionStore', () => {
	it('round-trips a session', async () => {
		const store = createMemorySessionStore();
		const created = session({ client_name: 'claude-code' });
		await store.create(created);
		expect(await store.get(created.id)).toMatchObject({ client_name: 'claude-code' });
	});

	it('returns undefined for an unknown id', async () => {
		expect(await createMemorySessionStore().get('nope')).toBeUndefined();
	});

	it('hands out a copy, so a caller cannot mutate the store', async () => {
		const store = createMemorySessionStore();
		const created = session();
		await store.create(created);
		const read = (await store.get(created.id))!;
		read.org_id = 'tampered';
		expect((await store.get(created.id))!.org_id).toBeUndefined();
	});

	it('deletes', async () => {
		const store = createMemorySessionStore();
		const created = session();
		await store.create(created);
		await store.delete(created.id);
		expect(await store.get(created.id)).toBeUndefined();
	});

	it('expires a session that has gone quiet past the ttl', async () => {
		vi.useFakeTimers();
		try {
			const store = createMemorySessionStore({ ttl_ms: 1000 });
			const created = session();
			await store.create(created);
			vi.advanceTimersByTime(1001);
			expect(await store.get(created.id)).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a session alive while it is being touched', async () => {
		vi.useFakeTimers();
		try {
			const store = createMemorySessionStore({ ttl_ms: 1000 });
			const created = session();
			await store.create(created);
			for (let i = 0; i < 5; i++) {
				vi.advanceTimersByTime(900);
				await store.touch(created.id, Date.now());
			}
			expect(await store.get(created.id)).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	});
});
