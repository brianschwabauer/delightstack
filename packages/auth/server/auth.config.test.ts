import { describe, it, expect } from 'vitest';
import { defineAuthConfig } from './auth.config';

describe('defineAuthConfig', () => {
	const minimal = {
		secret: 'abc123',
		issuer: 'test',
		permissions: ['read', 'write'] as const,
		oauth_scopes: ['profile'] as const,
	};

	it('fills in default base_path', () => {
		const config = defineAuthConfig(minimal);
		expect(config.base_path).toBe('/api/auth');
	});

	it('fills in default csrf', () => {
		const config = defineAuthConfig(minimal);
		expect(config.csrf).toBe(true);
	});

	it('fills in default cookie settings', () => {
		const config = defineAuthConfig(minimal);
		expect(config.cookies).toEqual({
			session_name: 'auth-session',
			preferences_name: 'auth-pref',
			org_state_prefix: 'auth-org-',
			path: '/',
			http_only: true,
			secure: true, // dev=false by default
			same_site: 'lax',
		});
	});

	it('fills in default session settings', () => {
		const config = defineAuthConfig(minimal);
		expect(config.session).toEqual({
			expires_in: 3600,
			refresh_threshold: 600,
		});
	});

	it('sets secure=false in dev mode', () => {
		const config = defineAuthConfig({ ...minimal, dev: true });
		expect(config.cookies.secure).toBe(false);
	});

	it('preserves custom overrides', () => {
		const config = defineAuthConfig({
			...minimal,
			base_path: '/auth',
			csrf: { allowed_origins: ['https://example.com'] },
			cookies: {
				session_name: 'my-session',
				path: '/app',
			},
			session: {
				expires_in: 7200,
			},
		});

		expect(config.base_path).toBe('/auth');
		expect(config.csrf).toEqual({ allowed_origins: ['https://example.com'] });
		expect(config.cookies.session_name).toBe('my-session');
		expect(config.cookies.path).toBe('/app');
		// Defaults still filled for non-overridden values
		expect(config.cookies.http_only).toBe(true);
		expect(config.cookies.secure).toBe(true);
		expect(config.session.expires_in).toBe(7200);
		expect(config.session.refresh_threshold).toBe(600); // default
	});

	it('preserves permissions and oauth_scopes from input', () => {
		const config = defineAuthConfig(minimal);
		expect(config.permissions).toEqual(['read', 'write']);
		expect(config.oauth_scopes).toEqual(['profile']);
	});
});
