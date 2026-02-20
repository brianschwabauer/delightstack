import { describe, it, expect, vi } from 'vitest';
import { createAuthGuards } from './guards';
import type { AuthLocals } from '../server/auth.handler';
import type { SessionToken } from '../types';

// Mock SvelteKit's redirect by throwing an error with status/location
vi.mock('@sveltejs/kit', () => ({
	redirect: (status: number, location: string) => {
		const err = new Error(`Redirect: ${status} ${location}`) as Error & {
			status: number;
			location: string;
		};
		err.status = status;
		err.location = location;
		throw err;
	},
}));

const PERMISSION_MAP = {
	'org:read': 0,
	'org:write': 1,
	'org:admin': 2,
	'org:owner': 3,
} as const;

const guards = createAuthGuards({
	secret: 'test-secret',
	issuer: 'test',
	permission_map: PERMISSION_MAP,
	oauth_capability_map: {},
});

function makeLocals(overrides: Partial<AuthLocals> = {}): AuthLocals {
	return {
		session: null,
		jwt: null,
		user: null,
		org_id: null,
		org: null,
		meta: {},
		auth: {} as AuthLocals['auth'],
		...overrides,
	};
}

function makeAuthLocals(role = 0b1111): AuthLocals {
	const session = {
		typ: 'auth',
		uid: 'user_1',
		name: 'Test User',
		email: 'test@example.com',
		verified: true,
		sub: 'ua_1',
		jti: 'us_1',
		org: {
			org_1: { name: 'Test Org', role, db: 'db_1', plan: 1 },
		},
		iss: 'test',
		iat: Math.floor(Date.now() / 1000),
		exp: Math.floor(Date.now() / 1000) + 3600,
	} as SessionToken<'auth'>;

	return makeLocals({
		session,
		jwt: 'test-jwt',
		user: {
			id: 'user_1',
			name: 'Test User',
			email: 'test@example.com',
			verified: true,
			user_auth_id: 'ua_1',
			user_session_id: 'us_1',
		},
		org_id: 'org_1',
		org: { id: 'org_1', name: 'Test Org', role, db: 'db_1', plan: 1 },
	});
}

function makeEvent(locals: AuthLocals, pathname = '/dashboard') {
	return {
		locals,
		url: new URL(`http://localhost${pathname}`),
	} as unknown as Parameters<ReturnType<typeof guards.requireAuth>>[0];
}

describe('createAuthGuards', () => {
	describe('requireAuth', () => {
		it('calls the load function when authenticated', async () => {
			const loadFn = vi.fn().mockResolvedValue({ user: 'data' });
			const guarded = guards.requireAuth(loadFn);
			const event = makeEvent(makeAuthLocals());

			const result = await guarded(event);
			expect(result).toEqual({ user: 'data' });
			expect(loadFn).toHaveBeenCalledOnce();
		});

		it('redirects to /signin when not authenticated', async () => {
			const loadFn = vi.fn();
			const guarded = guards.requireAuth(loadFn);
			const event = makeEvent(makeLocals(), '/dashboard');

			await expect(guarded(event)).rejects.toThrow('Redirect: 302');
			expect(loadFn).not.toHaveBeenCalled();
		});

		it('includes return path in redirect URL', async () => {
			const loadFn = vi.fn();
			const guarded = guards.requireAuth(loadFn);
			const event = makeEvent(makeLocals(), '/dashboard/settings');

			try {
				await guarded(event);
			} catch (err: unknown) {
				const error = err as { location: string };
				expect(error.location).toContain('/signin');
				expect(error.location).toContain(
					encodeURIComponent('/dashboard/settings'),
				);
			}
		});

		it('uses custom redirect_to when provided', async () => {
			const loadFn = vi.fn();
			const guarded = guards.requireAuth(loadFn, {
				redirect_to: '/login',
			});
			const event = makeEvent(makeLocals());

			try {
				await guarded(event);
			} catch (err: unknown) {
				const error = err as { location: string };
				expect(error.location).toContain('/login');
			}
		});
	});

	describe('requireOrg', () => {
		it('calls the load function when authenticated with org', async () => {
			const loadFn = vi.fn().mockResolvedValue({ data: true });
			const guarded = guards.requireOrg(loadFn);
			const event = makeEvent(makeAuthLocals());

			const result = await guarded(event);
			expect(result).toEqual({ data: true });
		});

		it('redirects to /signin when not authenticated', async () => {
			const loadFn = vi.fn();
			const guarded = guards.requireOrg(loadFn);
			const event = makeEvent(makeLocals());

			await expect(guarded(event)).rejects.toThrow('Redirect: 302');
			expect(loadFn).not.toHaveBeenCalled();
		});

		it('redirects to /org/select when authenticated but no org', async () => {
			const locals = makeAuthLocals();
			locals.org_id = null;
			locals.org = null;
			const loadFn = vi.fn();
			const guarded = guards.requireOrg(loadFn);
			const event = makeEvent(locals);

			try {
				await guarded(event);
			} catch (err: unknown) {
				const error = err as { location: string };
				expect(error.location).toBe('/org/select');
			}
		});
	});

	describe('requirePermission', () => {
		it('calls the load function when user has the required permission', async () => {
			// role = 0b1111 means all 4 permissions (bits 0,1,2,3) are set
			const loadFn = vi.fn().mockResolvedValue({ data: true });
			const guarded = guards.requirePermission('org:admin', loadFn);
			const event = makeEvent(makeAuthLocals(0b1111));

			const result = await guarded(event);
			expect(result).toEqual({ data: true });
		});

		it('redirects to /403 when user lacks the permission', async () => {
			// role = 0b0001 means only bit 0 (org:read) is set
			const loadFn = vi.fn();
			const guarded = guards.requirePermission('org:admin', loadFn);
			const event = makeEvent(makeAuthLocals(0b0001));

			try {
				await guarded(event);
			} catch (err: unknown) {
				const error = err as { location: string };
				expect(error.location).toBe('/403');
			}
			expect(loadFn).not.toHaveBeenCalled();
		});

		it('uses custom forbidden_redirect when provided', async () => {
			const loadFn = vi.fn();
			const guarded = guards.requirePermission('org:admin', loadFn, {
				forbidden_redirect: '/unauthorized',
			});
			const event = makeEvent(makeAuthLocals(0b0001));

			try {
				await guarded(event);
			} catch (err: unknown) {
				const error = err as { location: string };
				expect(error.location).toBe('/unauthorized');
			}
		});

		it('redirects to /signin when not authenticated', async () => {
			const loadFn = vi.fn();
			const guarded = guards.requirePermission('org:read', loadFn);
			const event = makeEvent(makeLocals());

			await expect(guarded(event)).rejects.toThrow('Redirect: 302');
		});

		it('redirects to /org/select when no org is selected', async () => {
			const locals = makeAuthLocals();
			locals.org_id = null;
			locals.org = null;
			const loadFn = vi.fn();
			const guarded = guards.requirePermission('org:read', loadFn);
			const event = makeEvent(locals);

			try {
				await guarded(event);
			} catch (err: unknown) {
				const error = err as { location: string };
				expect(error.location).toBe('/org/select');
			}
		});
	});
});
