import { describe, it, expect } from 'vitest';
import { defineAuthConfig } from './auth.config';

describe('defineAuthConfig', () => {
	const minimal = {
		secret: 'a'.repeat(64),
		issuer: 'test',
		permissions: ['read', 'write'] as const,
		oauth_scopes: ['profile'] as const,
		entitlements: ['premium', 'video-uploads'] as const,
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

	it('throws if secret is not hex-encoded', () => {
		expect(() => defineAuthConfig({ ...minimal, secret: 'not-hex!' })).toThrow('hex-encoded');
	});

	it('throws if secret is too short', () => {
		expect(() => defineAuthConfig({ ...minimal, secret: 'abcdef' })).toThrow('hex-encoded');
	});

	it('accepts a valid 64-char hex secret', () => {
		expect(() => defineAuthConfig({ ...minimal, secret: 'ab'.repeat(32) })).not.toThrow();
	});

	it('throws if permissions array exceeds 32 entries', () => {
		const permissions = Array.from({ length: 33 }, (_, i) => `perm_${i}`);
		expect(() => defineAuthConfig({ ...minimal, permissions })).toThrow('permissions array exceeds 32');
	});

	it('throws if oauth_scopes array exceeds 32 entries', () => {
		const oauth_scopes = Array.from({ length: 33 }, (_, i) => `scope_${i}`);
		expect(() => defineAuthConfig({ ...minimal, oauth_scopes })).toThrow('oauth_scopes array exceeds 32');
	});

	it('allows exactly 32 permissions', () => {
		const permissions = Array.from({ length: 32 }, (_, i) => `perm_${i}`);
		expect(() => defineAuthConfig({ ...minimal, permissions })).not.toThrow();
	});

	it('preserves entitlements from input', () => {
		const config = defineAuthConfig(minimal);
		expect(config.entitlements).toEqual(['premium', 'video-uploads']);
	});

	it('defaults entitlements to empty array', () => {
		const { entitlements: _, ...withoutEntitlements } = minimal;
		const config = defineAuthConfig(withoutEntitlements);
		expect(config.entitlements).toEqual([]);
	});

	it('throws if entitlements array exceeds 32 entries', () => {
		const entitlements = Array.from({ length: 33 }, (_, i) => `ent_${i}`);
		expect(() => defineAuthConfig({ ...minimal, entitlements })).toThrow('entitlements array exceeds 32');
	});

	it('allows exactly 32 entitlements', () => {
		const entitlements = Array.from({ length: 32 }, (_, i) => `ent_${i}`);
		expect(() => defineAuthConfig({ ...minimal, entitlements })).not.toThrow();
	});
});
