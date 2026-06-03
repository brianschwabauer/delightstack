import { describe, it, expect } from 'vitest';
import {
	generateJwt,
	decodeJwt,
	extractJwtRefreshToken,
	getSecretKey,
} from './jwt.server';

// A valid 256-bit hex secret (64 hex chars = 32 bytes)
const SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
// A different secret for mismatch tests
const WRONG_SECRET = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

describe('getSecretKey', () => {
	it('imports a valid hex secret as an HMAC key', async () => {
		const key = await getSecretKey(SECRET);
		expect(key).toBeDefined();
		expect(key.type).toBe('secret');
		expect(key.algorithm).toMatchObject({ name: 'HMAC' });
	});
});

describe('generateJwt', () => {
	it('generates a JWT with three base64url-encoded parts', async () => {
		const result = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
		});

		expect(result.jwt).toBeDefined();
		const parts = result.jwt.split('.');
		expect(parts).toHaveLength(3);
		// No padding characters
		expect(result.jwt).not.toContain('=');
	});

	it('returns decoded_jwt matching the input claims', async () => {
		const now = Math.floor(Date.now() / 1000);
		const result = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
			iat: now,
			exp: now + 3600,
		});

		expect(result.decoded_jwt.typ).toBe('auth');
		expect(result.decoded_jwt.iss).toBe('test');
		expect(result.decoded_jwt.uid).toBe('user_1');
		expect((result.decoded_jwt as { name: string }).name).toBe('Test');
		expect(result.decoded_jwt.iat).toBe(now);
		expect(result.decoded_jwt.exp).toBe(now + 3600);
	});

	it('auto-generates jti if not provided', async () => {
		const result = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
		});

		expect(result.decoded_jwt.jti).toBeDefined();
		expect(result.jwt_id).toBe(result.decoded_jwt.jti);
	});

	it('uses provided jti when given', async () => {
		const result = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
			jti: 'custom_jti_123',
		});

		expect(result.decoded_jwt.jti).toBe('custom_jti_123');
	});

	it('defaults typ to auth if not provided', async () => {
		const result = await generateJwt(SECRET, {
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
		});

		expect(result.decoded_jwt.typ).toBe('auth');
	});

	it('sets header alg to HS256', async () => {
		const result = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
		});

		const header = JSON.parse(
			atob(result.jwt.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')),
		);
		expect(header.alg).toBe('HS256');
		expect(header.typ).toBe('JWT');
		expect(header.kid).toBeDefined();
	});
});

describe('decodeJwt', () => {
	it('decodes a valid JWT', async () => {
		const now = Math.floor(Date.now() / 1000);
		const { jwt } = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
			iat: now,
			exp: now + 3600,
		});

		const decoded = await decodeJwt<'auth'>(SECRET, jwt);
		expect(decoded.typ).toBe('auth');
		expect(decoded.uid).toBe('user_1');
		expect(decoded.name).toBe('Test');
		expect(decoded.email).toBe('test@example.com');
	});

	it('throws on empty jwt', async () => {
		await expect(decodeJwt(SECRET, '')).rejects.toThrow('JWT not provided');
	});

	it('throws on malformed jwt', async () => {
		await expect(decodeJwt(SECRET, 'not-a-jwt')).rejects.toThrow();
	});

	it('throws on expired jwt', async () => {
		const now = Math.floor(Date.now() / 1000);
		const { jwt } = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
			iat: now - 7200,
			exp: now - 3600, // expired 1 hour ago (beyond 10min clock skew tolerance)
		});

		await expect(decodeJwt(SECRET, jwt)).rejects.toThrow('Auth token expired');
	});

	it('allows tokens within 10 minute clock skew', async () => {
		const now = Math.floor(Date.now() / 1000);
		const { jwt } = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
			iat: now,
			exp: now - 300, // expired 5 minutes ago (within 10min tolerance)
		});

		const decoded = await decodeJwt(SECRET, jwt);
		expect(decoded.uid).toBe('user_1');
	});

	it('throws on wrong secret (kid mismatch)', async () => {
		const { jwt } = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
		});

		await expect(decodeJwt(WRONG_SECRET, jwt)).rejects.toThrow('Key ID does not match');
	});

	it('throws on tampered payload', async () => {
		const { jwt } = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
		});

		// Tamper with the payload part
		const parts = jwt.split('.');
		const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
		payload.uid = 'user_hacker';
		parts[1] = btoa(JSON.stringify(payload))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+/g, '');
		const tampered = parts.join('.');

		await expect(decodeJwt(SECRET, tampered)).rejects.toThrow('Signature is invalid');
	});

	it('throws on future iat beyond clock skew', async () => {
		const now = Math.floor(Date.now() / 1000);
		const { jwt } = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
			iat: now + 900, // 15 minutes in the future (beyond 10min tolerance)
			exp: now + 4500,
		});

		await expect(decodeJwt(SECRET, jwt)).rejects.toThrow('Auth token expired');
	});

	it('roundtrips with generateJwt', async () => {
		const claims = {
			typ: 'auth' as const,
			iss: 'my-app',
			uid: 'user_42',
			sub: 'ua_42',
			name: 'Alice',
			email: 'alice@example.com',
			verified: true,
			org: {
				org_1: { n: 'Acme', p: 0b1111, d: 'db_1', e: 1 },
			},
		};

		const { jwt } = await generateJwt(SECRET, claims);
		const decoded = await decodeJwt<'auth'>(SECRET, jwt);

		expect(decoded.uid).toBe('user_42');
		expect(decoded.name).toBe('Alice');
		expect(decoded.org.org_1.n).toBe('Acme');
		expect(decoded.org.org_1.p).toBe(0b1111);
	});
});

describe('extractJwtRefreshToken', () => {
	it('extracts jti from a valid jwt', async () => {
		const { jwt, jwt_id } = await generateJwt(SECRET, {
			typ: 'auth',
			iss: 'test',
			uid: 'user_1',
			sub: 'ua_1',
			name: 'Test',
			email: 'test@example.com',
			verified: true,
			org: {},
			jti: 'session_abc123',
		});

		const jti = extractJwtRefreshToken(jwt);
		expect(jti).toBe('session_abc123');
		expect(jti).toBe(jwt_id);
	});

	it('throws on malformed jwt', () => {
		expect(() => extractJwtRefreshToken('garbage')).toThrow('Invalid auth token format');
	});

	it('throws when payload has no jti', () => {
		// Craft a JWT with no jti in payload
		const payload = btoa(JSON.stringify({ typ: 'auth', uid: 'user_1' }))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+/g, '');
		const fakeJwt = `header.${payload}.signature`;

		expect(() => extractJwtRefreshToken(fakeJwt)).toThrow('Invalid auth token format');
	});
});
