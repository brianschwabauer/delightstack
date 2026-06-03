import { describe, it, expect } from 'vitest';
import { matchRoute } from './auth.routes';

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
