import { describe, it, expect } from 'vitest';
import {
	signState,
	verifyState,
	serializeSessionCookie,
	serializeDeleteSessionCookie,
	serializePreferencesCookie,
	serializeOrgStateCookie,
} from './cookies';

// A valid hex-encoded HMAC-SHA256 secret (64 hex chars = 32 bytes)
const SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const OTHER_SECRET = 'f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2';

/** Precomputed base64url-encoded JWT header for HS256 */
const JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

describe('signState / verifyState (JWT format)', () => {
	it('round-trips a simple object', async () => {
		const data = { theme: 'dark', org_id: 'org_123' };
		const signed = await signState(data, SECRET);
		const result = await verifyState(signed, SECRET);
		expect(result).toEqual(data);
	});

	it('round-trips an empty object', async () => {
		const data = {};
		const signed = await signState(data, SECRET);
		const result = await verifyState(signed, SECRET);
		expect(result).toEqual({});
	});

	it('round-trips nested data', async () => {
		const data = { settings: { sidebar: true }, tags: [1, 2, 3] };
		const signed = await signState(data, SECRET);
		const result = await verifyState(signed, SECRET);
		expect(result).toEqual(data);
	});

	it('produces a valid JWT with header.payload.signature format', async () => {
		const signed = await signState({ a: 1 }, SECRET);
		const parts = signed.split('.');
		expect(parts).toHaveLength(3);
		expect(parts[0]).toBe(JWT_HEADER);
		// Verify the header decodes to the expected JSON
		const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
		expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
	});

	it('returns null for tampered payload', async () => {
		const signed = await signState({ theme: 'dark' }, SECRET);
		const parts = signed.split('.');
		// Tamper with the payload (index 1)
		const tampered_payload = (parts[1][0] === 'a' ? 'b' : 'a') + parts[1].slice(1);
		const tampered = `${parts[0]}.${tampered_payload}.${parts[2]}`;
		const result = await verifyState(tampered, SECRET);
		expect(result).toBeNull();
	});

	it('returns null for tampered signature', async () => {
		const signed = await signState({ theme: 'dark' }, SECRET);
		const parts = signed.split('.');
		// Tamper with the signature (index 2)
		const tampered_sig = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
		const tampered = `${parts[0]}.${parts[1]}.${tampered_sig}`;
		const result = await verifyState(tampered, SECRET);
		expect(result).toBeNull();
	});

	it('returns null for tampered header', async () => {
		const signed = await signState({ theme: 'dark' }, SECRET);
		const parts = signed.split('.');
		// Tamper with the header (index 0)
		const tampered_header = (parts[0][0] === 'a' ? 'b' : 'a') + parts[0].slice(1);
		const tampered = `${tampered_header}.${parts[1]}.${parts[2]}`;
		const result = await verifyState(tampered, SECRET);
		expect(result).toBeNull();
	});

	it('returns null for wrong secret', async () => {
		const signed = await signState({ theme: 'dark' }, SECRET);
		const result = await verifyState(signed, OTHER_SECRET);
		expect(result).toBeNull();
	});

	it('returns null for missing dots (no separator)', async () => {
		const result = await verifyState('nodothere', SECRET);
		expect(result).toBeNull();
	});

	it('returns null for only one dot (2-part non-JWT format)', async () => {
		const result = await verifyState('part1.part2', SECRET);
		expect(result).toBeNull();
	});

	it('returns null for empty string', async () => {
		const result = await verifyState('', SECRET);
		expect(result).toBeNull();
	});

	it('returns null for non-object JSON (array)', async () => {
		// Manually create a signed JWT with array payload
		const payload = btoa(JSON.stringify([1, 2, 3]))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');
		const signing_input = `${JWT_HEADER}.${payload}`;

		const keyBytes = new Uint8Array(SECRET.length / 2);
		for (let i = 0; i < SECRET.length; i += 2) {
			keyBytes[i / 2] = parseInt(SECRET.substr(i, 2), 16);
		}
		const key = await crypto.subtle.importKey(
			'raw',
			keyBytes,
			{ name: 'HMAC', hash: { name: 'SHA-256' } },
			false,
			['sign'],
		);
		const sig = await crypto.subtle.sign(
			'HMAC',
			key,
			new TextEncoder().encode(signing_input),
		);
		const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');

		const result = await verifyState(`${signing_input}.${sigStr}`, SECRET);
		expect(result).toBeNull();
	});

	it('returns null for non-object JSON (string)', async () => {
		const payload = btoa(JSON.stringify('hello'))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');
		const signing_input = `${JWT_HEADER}.${payload}`;

		const keyBytes = new Uint8Array(SECRET.length / 2);
		for (let i = 0; i < SECRET.length; i += 2) {
			keyBytes[i / 2] = parseInt(SECRET.substr(i, 2), 16);
		}
		const key = await crypto.subtle.importKey(
			'raw',
			keyBytes,
			{ name: 'HMAC', hash: { name: 'SHA-256' } },
			false,
			['sign'],
		);
		const sig = await crypto.subtle.sign(
			'HMAC',
			key,
			new TextEncoder().encode(signing_input),
		);
		const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');

		const result = await verifyState(`${signing_input}.${sigStr}`, SECRET);
		expect(result).toBeNull();
	});

	it('throws for oversized state', async () => {
		const large_data: Record<string, string> = {};
		for (let i = 0; i < 100; i++) {
			large_data[`key_${i}`] = 'x'.repeat(50);
		}
		await expect(signState(large_data, SECRET)).rejects.toThrow('exceeds');
	});

	it('handles special characters in values', async () => {
		const data = { name: 'héllo wörld', emoji: '🎉', path: '/foo/bar?q=1&b=2' };
		const signed = await signState(data, SECRET);
		const result = await verifyState(signed, SECRET);
		expect(result).toEqual(data);
	});
});

describe('serializing cookies for hand-built responses', () => {
	/** Mirrors the resolved config shape the serializers read */
	const CONFIG = {
		cookies: {
			session_name: 'app-session',
			preferences_name: 'app-pref',
			org_state_prefix: 'app-org-',
			path: '/',
			http_only: true,
			secure: true,
			same_site: 'lax',
		},
	} as unknown as Parameters<typeof serializeSessionCookie>[0];

	it('serializes the session cookie with the configured options', () => {
		const header = serializeSessionCookie(CONFIG, 'jwt.value.here');
		expect(header).toBe('app-session=jwt.value.here; Path=/; HttpOnly; Secure; SameSite=Lax');
	});

	it('serializes the preferences cookie so auth routes can persist it', async () => {
		// Auth routes return their own Response, which skips SvelteKit's cookie
		// pipeline — without a header here the preference write is silently lost
		const header = await serializePreferencesCookie(CONFIG, SECRET, { theme: 'dark' });
		expect(header.startsWith('app-pref=')).toBe(true);
		expect(header).toContain('Path=/');
		expect(header).toContain('HttpOnly');

		const value = decodeURIComponent(header.slice('app-pref='.length).split(';')[0]);
		expect(await verifyState(value, SECRET)).toEqual({ theme: 'dark' });
	});

	it('serializes an org state cookie under the org-specific name', async () => {
		const header = await serializeOrgStateCookie(CONFIG, SECRET, 'org_1', { last_tab: 2 });
		expect(header.startsWith('app-org-org_1=')).toBe(true);
		const value = decodeURIComponent(header.slice('app-org-org_1='.length).split(';')[0]);
		expect(await verifyState(value, SECRET)).toEqual({ last_tab: 2 });
	});

	it('serializes a deletion when there is nothing left to store', async () => {
		expect(await serializePreferencesCookie(CONFIG, SECRET, {})).toBe(
			'app-pref=; Path=/; Max-Age=0',
		);
		expect(await serializeOrgStateCookie(CONFIG, SECRET, 'org_1', {})).toBe(
			'app-org-org_1=; Path=/; Max-Age=0',
		);
		expect(serializeDeleteSessionCookie(CONFIG)).toBe('app-session=; Path=/; Max-Age=0');
	});
});
