import { describe, it, expect, vi } from 'vitest';
import { matchRoute } from './auth.routes';

type RouteCtx = Parameters<NonNullable<ReturnType<typeof matchRoute>>['handler']>[0];

/** The bit positions of PERMISSIONS below: read=1, write=2, admin=4, owner=8 */
const PERMISSIONS = ['org:read', 'org:write', 'org:admin', 'org:owner'] as const;

interface FakeCtxOptions {
	/** The caller's uid. Pass null for an unauthenticated request */
	uid?: string | null;
	/** The caller's org memberships: org_id -> permission bitmask */
	orgs?: Record<string, number>;
	/** Request body for handlers that read JSON */
	body?: unknown;
	/** Route params (normally merged from the matched route pattern) */
	params?: Record<string, string>;
	/** Stubbed AuthServer methods the handler calls */
	auth?: Record<string, unknown>;
}

function makeCtx(options: FakeCtxOptions = {}): RouteCtx {
	const uid = options.uid === null ? null : (options.uid ?? 'user_1');
	const org: Record<string, { p: number; n: string }> = {};
	for (const [id, p] of Object.entries(options.orgs ?? {})) {
		org[id] = { p, n: 'Org' };
	}
	const session = uid
		? {
				typ: 'auth',
				iss: 'test',
				uid,
				sub: 'ua_1',
				jti: 'us_1',
				name: 'Test',
				email: 'test@example.com',
				verified: true,
				org,
				iat: 0,
				exp: 9999999999,
			}
		: null;
	return {
		event: {
			request: { json: async () => options.body ?? {} },
			url: new URL('https://app.example.com/api/auth'),
			params: options.params ?? {},
		},
		config: {
			permissions: PERMISSIONS,
			org_admin_permission: 'org:admin',
			base_path: '/api/auth',
			secret: 'x'.repeat(64),
			issuer: 'test',
		},
		auth: options.auth ?? {},
		locals: {
			session,
			user: session ? { id: uid, name: 'Test', email: 'test@example.com' } : null,
		},
		meta: {},
	} as unknown as RouteCtx;
}

async function callRoute(method: string, path: string, options: FakeCtxOptions = {}) {
	const match = matchRoute(method, path);
	if (!match) throw new Error(`No route for ${method} ${path}`);
	const ctx = makeCtx({ ...options, params: { ...match.params, ...options.params } });
	const response = await match.handler(ctx);
	const body =
		response.status === 204 ? null : ((await response.json()) as Record<string, unknown>);
	return { response, body };
}

describe('matchRoute', () => {
	describe('static routes', () => {
		it('matches POST /signin/email', () => {
			const result = matchRoute('POST', '/signin/email');
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({});
		});

		it('matches POST /signin/email/magic', () => {
			const result = matchRoute('POST', '/signin/email/magic');
			expect(result).not.toBeNull();
		});

		it('matches GET /signin/email/verify', () => {
			const result = matchRoute('GET', '/signin/email/verify');
			expect(result).not.toBeNull();
		});

		it('matches POST /signin/email/code', () => {
			const result = matchRoute('POST', '/signin/email/code');
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({});
		});

		it('matches POST /signup/email', () => {
			const result = matchRoute('POST', '/signup/email');
			expect(result).not.toBeNull();
		});

		it('matches POST /signout', () => {
			const result = matchRoute('POST', '/signout');
			expect(result).not.toBeNull();
		});

		it('matches GET /signout', () => {
			const result = matchRoute('GET', '/signout');
			expect(result).not.toBeNull();
		});

		it('matches GET /session', () => {
			const result = matchRoute('GET', '/session');
			expect(result).not.toBeNull();
		});

		it('matches POST /session/refresh', () => {
			const result = matchRoute('POST', '/session/refresh');
			expect(result).not.toBeNull();
		});

		it('matches GET /session/list', () => {
			const result = matchRoute('GET', '/session/list');
			expect(result).not.toBeNull();
		});

		it('matches POST /password/reset', () => {
			const result = matchRoute('POST', '/password/reset');
			expect(result).not.toBeNull();
		});

		it('matches POST /password/reset/confirm', () => {
			const result = matchRoute('POST', '/password/reset/confirm');
			expect(result).not.toBeNull();
		});

		it('matches PATCH /password', () => {
			const result = matchRoute('PATCH', '/password');
			expect(result).not.toBeNull();
		});

		it('matches POST /password/check', () => {
			const result = matchRoute('POST', '/password/check');
			expect(result).not.toBeNull();
		});

		it('matches POST /email/verify', () => {
			const result = matchRoute('POST', '/email/verify');
			expect(result).not.toBeNull();
		});

		it('matches GET /email/verify/confirm', () => {
			const result = matchRoute('GET', '/email/verify/confirm');
			expect(result).not.toBeNull();
		});

		it('matches POST /email/verify/code', () => {
			const result = matchRoute('POST', '/email/verify/code');
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({});
		});

		it('matches GET /email/check', () => {
			const result = matchRoute('GET', '/email/check');
			expect(result).not.toBeNull();
		});

		it('matches GET /user', () => {
			const result = matchRoute('GET', '/user');
			expect(result).not.toBeNull();
		});

		it('matches PATCH /user', () => {
			const result = matchRoute('PATCH', '/user');
			expect(result).not.toBeNull();
		});

		it('matches DELETE /user', () => {
			const result = matchRoute('DELETE', '/user');
			expect(result).not.toBeNull();
		});

		it('matches PATCH /preference', () => {
			const result = matchRoute('PATCH', '/preference');
			expect(result).not.toBeNull();
		});

		it('matches POST /org', () => {
			const result = matchRoute('POST', '/org');
			expect(result).not.toBeNull();
		});

		it('matches POST /org/switch', () => {
			const result = matchRoute('POST', '/org/switch');
			expect(result).not.toBeNull();
		});

		it('matches GET /invitation', () => {
			const result = matchRoute('GET', '/invitation');
			expect(result).not.toBeNull();
		});

		it('matches POST /invitation', () => {
			const result = matchRoute('POST', '/invitation');
			expect(result).not.toBeNull();
		});

		it('matches GET /oauth/account', () => {
			const result = matchRoute('GET', '/oauth/account');
			expect(result).not.toBeNull();
		});

		it('matches GET /oauth/authorize', () => {
			const result = matchRoute('GET', '/oauth/authorize');
			expect(result).not.toBeNull();
		});

		it('matches POST /oauth/authorize', () => {
			const result = matchRoute('POST', '/oauth/authorize');
			expect(result).not.toBeNull();
		});

		it('matches POST /oauth/token', () => {
			const result = matchRoute('POST', '/oauth/token');
			expect(result).not.toBeNull();
		});

		it('matches GET /oauth/application', () => {
			const result = matchRoute('GET', '/oauth/application');
			expect(result).not.toBeNull();
		});

		it('matches POST /oauth/application', () => {
			const result = matchRoute('POST', '/oauth/application');
			expect(result).not.toBeNull();
		});
	});

	describe('parameterized routes', () => {
		it('matches DELETE /session/:id and extracts id param', () => {
			const result = matchRoute('DELETE', '/session/sess_abc123');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('sess_abc123');
		});

		it('matches GET /signin/:vendor and extracts vendor param', () => {
			const result = matchRoute('GET', '/signin/google');
			expect(result).not.toBeNull();
			expect(result!.params.vendor).toBe('google');
		});

		it('matches GET /signin/:vendor/callback and extracts vendor param', () => {
			const result = matchRoute('GET', '/signin/github/callback');
			expect(result).not.toBeNull();
			expect(result!.params.vendor).toBe('github');
		});

		it('matches PATCH /org/:id and extracts id param', () => {
			const result = matchRoute('PATCH', '/org/org_xyz');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('org_xyz');
		});

		it('matches DELETE /org/:id and extracts id param', () => {
			const result = matchRoute('DELETE', '/org/org_xyz');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('org_xyz');
		});

		it('matches GET /org/:id/user', () => {
			const result = matchRoute('GET', '/org/org_abc/user');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('org_abc');
		});

		it('matches PATCH /org/:id/user/:user_id and extracts both params', () => {
			const result = matchRoute('PATCH', '/org/org_abc/user/user_123');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('org_abc');
			expect(result!.params.user_id).toBe('user_123');
		});

		it('matches DELETE /org/:id/user/:user_id and extracts both params', () => {
			const result = matchRoute('DELETE', '/org/org_abc/user/user_123');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('org_abc');
			expect(result!.params.user_id).toBe('user_123');
		});

		it('matches PATCH /org/:id/state and extracts id param', () => {
			const result = matchRoute('PATCH', '/org/org_abc/state');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('org_abc');
		});

		it('matches GET /invitation/:id', () => {
			const result = matchRoute('GET', '/invitation/inv_abc');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('inv_abc');
		});

		it('matches POST /invitation/:id/accept', () => {
			const result = matchRoute('POST', '/invitation/inv_abc/accept');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('inv_abc');
		});

		it('matches DELETE /oauth/account/:id', () => {
			const result = matchRoute('DELETE', '/oauth/account/oa_123');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('oa_123');
		});

		it('matches GET /oauth/:vendor and extracts vendor param', () => {
			const result = matchRoute('GET', '/oauth/google');
			expect(result).not.toBeNull();
			expect(result!.params.vendor).toBe('google');
		});

		it('matches GET /oauth/:vendor/callback', () => {
			const result = matchRoute('GET', '/oauth/google/callback');
			expect(result).not.toBeNull();
			expect(result!.params.vendor).toBe('google');
		});

		it('matches GET /oauth/application/:id', () => {
			const result = matchRoute('GET', '/oauth/application/app_123');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('app_123');
		});

		it('matches POST /oauth/application/:id/secret', () => {
			const result = matchRoute('POST', '/oauth/application/app_123/secret');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('app_123');
		});

		it('matches DELETE /oauth/application/:id/secret/:secret_id', () => {
			const result = matchRoute('DELETE', '/oauth/application/app_123/secret/sec_456');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('app_123');
			expect(result!.params.secret_id).toBe('sec_456');
		});

		it('matches POST /oauth/application/:id/revoke', () => {
			const result = matchRoute('POST', '/oauth/application/app_123/revoke');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('app_123');
		});

		it('matches DELETE /user/signin-method/:id', () => {
			const result = matchRoute('DELETE', '/user/signin-method/method_123');
			expect(result).not.toBeNull();
			expect(result!.params.id).toBe('method_123');
		});
	});

	describe('non-matching', () => {
		it('returns null for unknown paths', () => {
			expect(matchRoute('GET', '/unknown')).toBeNull();
			expect(matchRoute('POST', '/unknown/path')).toBeNull();
		});

		it('returns null for wrong HTTP method', () => {
			// GET /signin/email matches GET /signin/:vendor (correct — OAuth uses GET)
			expect(matchRoute('DELETE', '/signin/email')).toBeNull();
			expect(matchRoute('POST', '/session')).toBeNull();
			expect(matchRoute('PUT', '/user')).toBeNull();
		});

		it('returns null for paths with extra segments', () => {
			expect(matchRoute('POST', '/signin/email/extra')).toBeNull();
			expect(matchRoute('GET', '/user/extra')).toBeNull();
		});

		it('returns null for empty path', () => {
			expect(matchRoute('GET', '')).toBeNull();
		});
	});

	describe('passkey routes', () => {
		it('matches POST /signin/passkey/options', () => {
			const result = matchRoute('POST', '/signin/passkey/options');
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({});
		});

		it('matches POST /signin/passkey', () => {
			const result = matchRoute('POST', '/signin/passkey');
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({});
		});

		it('matches POST /passkey/options', () => {
			const result = matchRoute('POST', '/passkey/options');
			expect(result).not.toBeNull();
		});

		it('matches POST /passkey', () => {
			expect(matchRoute('POST', '/passkey')).not.toBeNull();
		});

		it('matches GET /passkey', () => {
			expect(matchRoute('GET', '/passkey')).not.toBeNull();
		});

		it('matches PATCH /passkey/:id with a base64url credential id', () => {
			const result = matchRoute('PATCH', '/passkey/Y3JlZGVudGlhbC1pZA');
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({ id: 'Y3JlZGVudGlhbC1pZA' });
		});

		it('matches DELETE /passkey/:id', () => {
			const result = matchRoute('DELETE', '/passkey/cred_123-abc');
			expect(result).not.toBeNull();
			expect(result!.params).toEqual({ id: 'cred_123-abc' });
		});

		it('does not let GET /signin/:vendor swallow POST passkey sign-in', () => {
			// POST /signin/passkey must match the passkey route, not error on :vendor
			const result = matchRoute('POST', '/signin/passkey');
			expect(result).not.toBeNull();
			expect(result!.params.vendor).toBeUndefined();
		});
	});

	describe('org route authorization', () => {
		const ADMIN = 0b0111; // org:read + org:write + org:admin
		const MEMBER = 0b0011; // org:read + org:write

		function orgAuth(owner_id = 'owner_1') {
			return {
				getOrg: vi.fn(async () => ({ id: 'org_1', owner_id })),
				updateOrg: vi.fn(async () => ({})),
				markOrgDeleted: vi.fn(async () => {}),
				listOrgUsers: vi.fn(async () => ({ list: [], count: 0, hasMore: false })),
				updateUserPermission: vi.fn(async () => {}),
			};
		}

		it('rejects unauthenticated org updates', async () => {
			const { response } = await callRoute('PATCH', '/org/org_1', {
				uid: null,
				body: { name: 'New' },
			});
			expect(response.status).toBe(401);
		});

		it('lets an org admin rename the org', async () => {
			const auth = orgAuth();
			const { response } = await callRoute('PATCH', '/org/org_1', {
				orgs: { org_1: ADMIN },
				body: { name: 'New Name' },
				auth,
			});
			expect(response.status).toBe(204);
			expect(auth.updateOrg).toHaveBeenCalledWith('org_1', { name: 'New Name' });
		});

		it('rejects a rename from a non-admin member', async () => {
			const auth = orgAuth();
			const { response, body } = await callRoute('PATCH', '/org/org_1', {
				orgs: { org_1: MEMBER },
				body: { name: 'New Name' },
				auth,
			});
			expect(response.status).toBe(403);
			expect(body!.code).toBe('permission_denied');
			expect(auth.updateOrg).not.toHaveBeenCalled();
		});

		it('lets the owner rename without the admin permission bit', async () => {
			const auth = orgAuth('user_1');
			const { response } = await callRoute('PATCH', '/org/org_1', {
				uid: 'user_1',
				orgs: { org_1: MEMBER },
				body: { name: 'New Name' },
				auth,
			});
			expect(response.status).toBe(204);
		});

		it('rejects an ownership transfer from an admin who is not the owner', async () => {
			const auth = orgAuth('owner_1');
			const { response, body } = await callRoute('PATCH', '/org/org_1', {
				uid: 'user_1',
				orgs: { org_1: ADMIN },
				body: { owner_id: 'user_1' },
				auth,
			});
			expect(response.status).toBe(403);
			expect(body!.code).toBe('permission_denied');
			expect(auth.updateOrg).not.toHaveBeenCalled();
		});

		it('lets the current owner transfer ownership', async () => {
			const auth = orgAuth('user_1');
			const { response } = await callRoute('PATCH', '/org/org_1', {
				uid: 'user_1',
				orgs: { org_1: ADMIN },
				body: { owner_id: 'user_2' },
				auth,
			});
			expect(response.status).toBe(204);
			expect(auth.updateOrg).toHaveBeenCalledWith('org_1', { owner_id: 'user_2' });
		});

		it('treats a no-op owner_id (already the owner) as a normal update', async () => {
			const auth = orgAuth('owner_1');
			const { response } = await callRoute('PATCH', '/org/org_1', {
				uid: 'user_1',
				orgs: { org_1: ADMIN },
				body: { owner_id: 'owner_1', name: 'New Name' },
				auth,
			});
			expect(response.status).toBe(204);
		});

		it('only lets the owner delete the org', async () => {
			const auth = orgAuth('owner_1');
			const denied = await callRoute('DELETE', '/org/org_1', {
				uid: 'user_1',
				orgs: { org_1: ADMIN },
				auth,
			});
			expect(denied.response.status).toBe(403);
			expect(auth.markOrgDeleted).not.toHaveBeenCalled();

			const allowed = await callRoute('DELETE', '/org/org_1', {
				uid: 'owner_1',
				orgs: { org_1: ADMIN },
				auth,
			});
			expect(allowed.response.status).toBe(204);
			expect(auth.markOrgDeleted).toHaveBeenCalledWith('org_1');
		});

		it('only lets members list org users', async () => {
			const auth = orgAuth();
			const denied = await callRoute('GET', '/org/org_1/user', { orgs: {}, auth });
			expect(denied.response.status).toBe(403);

			const allowed = await callRoute('GET', '/org/org_1/user', {
				orgs: { org_1: MEMBER },
				auth,
			});
			expect(allowed.response.status).toBe(200);
		});

		it('requires admin to change another user permission', async () => {
			const auth = orgAuth();
			const denied = await callRoute('PATCH', '/org/org_1/user/user_2', {
				orgs: { org_1: MEMBER },
				body: { permission: 1 },
				auth,
			});
			expect(denied.response.status).toBe(403);
			expect(auth.updateUserPermission).not.toHaveBeenCalled();

			const allowed = await callRoute('PATCH', '/org/org_1/user/user_2', {
				orgs: { org_1: ADMIN },
				body: { permission: 1 },
				auth,
			});
			expect(allowed.response.status).toBe(204);
			expect(auth.updateUserPermission).toHaveBeenCalledWith('user_2', 'org_1', 1);
		});

		it('lets a member remove themselves but not others', async () => {
			const auth = orgAuth();
			const leave = await callRoute('DELETE', '/org/org_1/user/user_1', {
				uid: 'user_1',
				orgs: { org_1: MEMBER },
				auth,
			});
			expect(leave.response.status).toBe(204);
			expect(auth.updateUserPermission).toHaveBeenCalledWith('user_1', 'org_1', 0);

			const denied = await callRoute('DELETE', '/org/org_1/user/user_2', {
				uid: 'user_1',
				orgs: { org_1: MEMBER },
				auth,
			});
			expect(denied.response.status).toBe(403);
		});
	});

	describe('route priority', () => {
		it('prefers /signin/email/verify over /signin/:vendor with email', () => {
			const result = matchRoute('GET', '/signin/email/verify');
			expect(result).not.toBeNull();
			// If this matched /signin/:vendor, params would have vendor='email'
			// It should match the literal route instead
			expect(result!.params.vendor).toBeUndefined();
		});

		it('prefers /oauth/account over /oauth/:vendor for accounts', () => {
			const result = matchRoute('GET', '/oauth/account');
			expect(result).not.toBeNull();
			expect(result!.params.vendor).toBeUndefined();
		});

		it('prefers /oauth/authorize over /oauth/:vendor for authorize', () => {
			const result = matchRoute('GET', '/oauth/authorize');
			expect(result).not.toBeNull();
			expect(result!.params.vendor).toBeUndefined();
		});

		it('prefers /oauth/application over /oauth/:vendor for application', () => {
			const result = matchRoute('GET', '/oauth/application');
			expect(result).not.toBeNull();
			expect(result!.params.vendor).toBeUndefined();
		});
	});
});
