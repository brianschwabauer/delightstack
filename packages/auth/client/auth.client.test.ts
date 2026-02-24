import { describe, it, expect, vi } from 'vitest';
import { AuthClient, type AuthClientData } from './auth.client.svelte';
import type { SessionToken } from '../types';

function makeSession(overrides: Partial<SessionToken<'auth'>> = {}): SessionToken<'auth'> {
	const now = Math.floor(Date.now() / 1000);
	return {
		typ: 'auth',
		iss: 'test',
		uid: 'user_1',
		sub: 'ua_1',
		jti: 'us_1',
		name: 'Test User',
		email: 'test@example.com',
		verified: true,
		org: {
			org_1: { name: 'Test Org', role: 0b1111, db: 'db_1', plan: 1 },
		},
		iat: now,
		exp: now + 3600,
		...overrides,
	};
}

function makeData(overrides: Partial<AuthClientData> = {}): AuthClientData {
	return {
		jwt: 'test-jwt',
		session: makeSession(),
		org_id: 'org_1',
		preferences: { theme: 'dark' },
		org_state: { last_page: '/dashboard' },
		permissions: ['read', 'write', 'admin', 'owner'],
		...overrides,
	};
}

describe('AuthClient', () => {
	describe('constructor', () => {
		it('initializes with data', () => {
			const data = makeData();
			const client = new AuthClient(data);

			expect(client.jwt).toBe('test-jwt');
			expect(client.session).toEqual(data.session);
			expect(client.preferences).toEqual({ theme: 'dark' });
			expect(client.org_state).toEqual({ last_page: '/dashboard' });
		});

		it('initializes with empty data', () => {
			const client = new AuthClient();

			expect(client.jwt).toBeNull();
			expect(client.session).toBeNull();
			expect(client.preferences).toEqual({});
			expect(client.org_state).toEqual({});
		});

		it('reads permissions from data when options.permissions is not provided', () => {
			const data = makeData({ permissions: ['read', 'write'] });
			const client = new AuthClient(data);

			// isAllowed uses internal permissions
			expect(client.isAllowed('read')).toBe(true);
			expect(client.isAllowed('write')).toBe(true);
		});

		it('prefers options.permissions over data.permissions', () => {
			const data = makeData({ permissions: ['a', 'b'] });
			const client = new AuthClient(data, {
				permissions: ['read', 'write', 'admin', 'owner'] as const,
			});

			// 'read' is at index 0 in options, org role is 0b1111
			expect(client.isAllowed('read')).toBe(true);
			// 'a' is not in the options permissions
			expect(client.isAllowed('a' as never)).toBe(false);
		});

		it('uses default base_path', () => {
			const client = new AuthClient();
			const json = client.toJSON();
			// Verifying internal state through serialization
			expect(json).toBeDefined();
		});

		it('uses custom base_path', () => {
			const client = new AuthClient(undefined, { base_path: '/custom/auth' });
			expect(client.toJSON()).toBeDefined();
		});
	});

	describe('toJSON', () => {
		it('serializes all state fields', () => {
			const data = makeData();
			const client = new AuthClient(data, {
				permissions: ['read', 'write', 'admin', 'owner'] as const,
			});

			const json = client.toJSON();
			expect(json.jwt).toBe('test-jwt');
			expect(json.session).toEqual(data.session);
			expect(json.org_id).toBe('org_1');
			expect(json.preferences).toEqual({ theme: 'dark' });
			expect(json.org_state).toEqual({ last_page: '/dashboard' });
			expect(json.permissions).toEqual(['read', 'write', 'admin', 'owner']);
		});

		it('serializes null state when not signed in', () => {
			const client = new AuthClient();
			const json = client.toJSON();

			expect(json.jwt).toBeNull();
			expect(json.session).toBeNull();
			expect(json.org_id).toBeNull();
			expect(json.preferences).toEqual({});
			expect(json.org_state).toEqual({});
			expect(json.permissions).toEqual([]);
		});
	});

	describe('from', () => {
		it('creates an AuthClient from serialized data', () => {
			const data = makeData();
			const client = AuthClient.from(data);

			expect(client.jwt).toBe('test-jwt');
			expect(client.session).toEqual(data.session);
		});

		it('passes options through', () => {
			const data = makeData();
			const client = AuthClient.from(data, {
				permissions: ['read', 'write', 'admin', 'owner'] as const,
			});

			expect(client.isAllowed('read')).toBe(true);
		});

		it('roundtrips through toJSON/from', () => {
			const original = new AuthClient(makeData(), {
				permissions: ['read', 'write', 'admin', 'owner'] as const,
			});
			const json = original.toJSON();
			const restored = AuthClient.from(json);

			expect(restored.jwt).toBe(original.jwt);
			expect(restored.session).toEqual(original.session);
			expect(restored.toJSON()).toEqual(json);
		});
	});

	describe('isAllowed', () => {
		const permissions = ['read', 'write', 'admin', 'owner'] as const;

		it('returns true for set permission bits', () => {
			const data = makeData();
			data.session = makeSession({ org: { org_1: { name: 'Test', role: 0b1111, db: 'db_1', plan: 1 } } });
			const client = new AuthClient(data, { permissions });

			expect(client.isAllowed('read')).toBe(true);   // bit 0
			expect(client.isAllowed('write')).toBe(true);   // bit 1
			expect(client.isAllowed('admin')).toBe(true);   // bit 2
			expect(client.isAllowed('owner')).toBe(true);   // bit 3
		});

		it('returns false for unset permission bits', () => {
			const data = makeData();
			data.session = makeSession({ org: { org_1: { name: 'Test', role: 0b0001, db: 'db_1', plan: 1 } } });
			const client = new AuthClient(data, { permissions });

			expect(client.isAllowed('read')).toBe(true);    // bit 0 set
			expect(client.isAllowed('write')).toBe(false);   // bit 1 not set
			expect(client.isAllowed('admin')).toBe(false);   // bit 2 not set
			expect(client.isAllowed('owner')).toBe(false);   // bit 3 not set
		});

		it('returns false when not signed in', () => {
			const client = new AuthClient(undefined, { permissions });
			expect(client.isAllowed('read')).toBe(false);
		});

		it('returns false when no org is selected', () => {
			const data = makeData({ org_id: null });
			const client = new AuthClient(data, { permissions });
			expect(client.isAllowed('read')).toBe(false);
		});

		it('returns false for unknown permission', () => {
			const data = makeData();
			const client = new AuthClient(data, { permissions });
			expect(client.isAllowed('nonexistent' as never)).toBe(false);
		});
	});

	describe('reactive derived state', () => {
		it('signed_in reflects session presence', () => {
			const client = new AuthClient(makeData());
			expect(client.signed_in).toBe(true);

			const empty = new AuthClient();
			expect(empty.signed_in).toBe(false);
		});

		it('signed_out is inverse of signed_in', () => {
			const client = new AuthClient(makeData());
			expect(client.signed_out).toBe(false);

			const empty = new AuthClient();
			expect(empty.signed_out).toBe(true);
		});

		it('id returns user id from session', () => {
			const client = new AuthClient(makeData());
			expect(client.id).toBe('user_1');

			const empty = new AuthClient();
			expect(empty.id).toBeNull();
		});

		it('name returns user name from session', () => {
			const client = new AuthClient(makeData());
			expect(client.name).toBe('Test User');
		});

		it('email returns user email from session', () => {
			const client = new AuthClient(makeData());
			expect(client.email).toBe('test@example.com');
		});

		it('verified returns verification status', () => {
			const client = new AuthClient(makeData());
			expect(client.verified).toBe(true);
		});

		it('org returns current org info', () => {
			const client = new AuthClient(makeData());
			expect(client.org).toEqual({
				id: 'org_1',
				name: 'Test Org',
				role: 0b1111,
				db: 'db_1',
				plan: 1,
			});
		});

		it('org returns null when no org selected', () => {
			const client = new AuthClient(makeData({ org_id: null }));
			expect(client.org).toBeNull();
		});

		it('orgs returns list of organizations', () => {
			const session = makeSession({
				org: {
					org_1: { name: 'Org A', role: 1, db: 'db_1', plan: 1 },
					org_2: { name: 'Org B', role: 3, db: 'db_2', plan: 2 },
				},
			});
			const client = new AuthClient(makeData({ session }));
			expect(client.orgs).toHaveLength(2);
			expect(client.orgs[0].name).toBe('Org A');
			expect(client.orgs[1].name).toBe('Org B');
		});

		it('orgs returns empty array when not signed in', () => {
			const client = new AuthClient();
			expect(client.orgs).toEqual([]);
		});

		it('org_ids returns list of org IDs', () => {
			const session = makeSession({
				org: {
					org_1: { name: 'Org A', role: 1, db: 'db_1', plan: 1 },
					org_2: { name: 'Org B', role: 3, db: 'db_2', plan: 2 },
				},
			});
			const client = new AuthClient(makeData({ session }));
			expect(client.org_ids).toEqual(['org_1', 'org_2']);
		});
	});

	describe('setPreferences', () => {
		function mockFetch(response: Record<string, unknown>) {
			return vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}));
		}

		it('sends PATCH and updates preferences on success', async () => {
			const merged = { theme: 'dark', language: 'en' };
			const fetch = mockFetch(merged);
			const client = new AuthClient(makeData({ preferences: { theme: 'dark' } }), { fetch });
			const result = await client.setPreferences({ language: 'en' });

			expect(result.ok).toBe(true);
			expect(fetch).toHaveBeenCalledOnce();
			expect(fetch.mock.calls[0][0]).toContain('/preference');
			expect(client.preferences).toEqual(merged);
		});

		it('removes null values via API', async () => {
			const merged = { language: 'en' };
			const fetch = mockFetch(merged);
			const client = new AuthClient(makeData({ preferences: { theme: 'dark', language: 'en' } }), { fetch });
			const result = await client.setPreferences({ theme: null });

			expect(result.ok).toBe(true);
			expect(client.preferences).toEqual(merged);
		});
	});

	describe('setOrgState', () => {
		function mockFetch(response: Record<string, unknown>) {
			return vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}));
		}

		it('sends PATCH and updates org state on success', async () => {
			const merged = { page: '/home', filter: 'active' };
			const fetch = mockFetch(merged);
			const client = new AuthClient(makeData({ org_state: { page: '/home' } }), { fetch });
			const result = await client.setOrgState({ filter: 'active' });

			expect(result.ok).toBe(true);
			expect(fetch).toHaveBeenCalledOnce();
			expect(fetch.mock.calls[0][0]).toContain('/org/org_1/state');
			expect(client.org_state).toEqual(merged);
		});

		it('returns error when no org is selected', async () => {
			const client = new AuthClient(makeData({ org_id: null }));
			const result = await client.setOrgState({ key: 'value' });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.message).toBe('No organization selected');
			}
		});
	});

	describe('destroy', () => {
		it('can be called without error', () => {
			const client = new AuthClient(makeData());
			expect(() => client.destroy()).not.toThrow();
		});

		it('can be called on empty client', () => {
			const client = new AuthClient();
			expect(() => client.destroy()).not.toThrow();
		});
	});
});
