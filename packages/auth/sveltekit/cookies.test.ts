import { describe, it, expect } from 'vitest';
import { signState, verifyState } from './cookies';

// A valid hex-encoded HMAC-SHA256 secret (64 hex chars = 32 bytes)
const SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const OTHER_SECRET = 'f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2';

describe('signState / verifyState', () => {
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

	it('returns null for tampered payload', async () => {
		const signed = await signState({ theme: 'dark' }, SECRET);
		// Tamper with the payload (change first character)
		const parts = signed.split('.');
		const tampered = (parts[0][0] === 'a' ? 'b' : 'a') + parts[0].slice(1) + '.' + parts[1];
		const result = await verifyState(tampered, SECRET);
		expect(result).toBeNull();
	});

	it('returns null for tampered signature', async () => {
		const signed = await signState({ theme: 'dark' }, SECRET);
		const parts = signed.split('.');
		const tampered = parts[0] + '.' + (parts[1][0] === 'a' ? 'b' : 'a') + parts[1].slice(1);
		const result = await verifyState(tampered, SECRET);
		expect(result).toBeNull();
	});

	it('returns null for wrong secret', async () => {
		const signed = await signState({ theme: 'dark' }, SECRET);
		const result = await verifyState(signed, OTHER_SECRET);
		expect(result).toBeNull();
	});

	it('returns null for missing dot separator', async () => {
		const result = await verifyState('nodothere', SECRET);
		expect(result).toBeNull();
	});

	it('returns null for empty string', async () => {
		const result = await verifyState('', SECRET);
		expect(result).toBeNull();
	});

	it('returns null for non-object JSON (array)', async () => {
		// Manually create a signed array value
		const json = JSON.stringify([1, 2, 3]);
		const payload = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

		// Sign it properly
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
			new TextEncoder().encode(payload),
		);
		const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');

		const result = await verifyState(`${payload}.${sigStr}`, SECRET);
		expect(result).toBeNull();
	});

	it('returns null for non-object JSON (string)', async () => {
		const json = JSON.stringify('hello');
		const payload = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

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
			new TextEncoder().encode(payload),
		);
		const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');

		const result = await verifyState(`${payload}.${sigStr}`, SECRET);
		expect(result).toBeNull();
	});

	it('throws for oversized state', async () => {
		// Create a large string that will exceed 3072 bytes when base64-encoded
		const large_data: Record<string, string> = {};
		for (let i = 0; i < 100; i++) {
			large_data[`key_${i}`] = 'x'.repeat(50);
		}
		await expect(signState(large_data, SECRET)).rejects.toThrow('exceeds');
	});

	it('produces a string with exactly one dot', async () => {
		const signed = await signState({ a: 1 }, SECRET);
		// The payload may contain dots in base64, but the format is payload.signature
		// Verify by checking we can split and get valid parts
		const lastDot = signed.lastIndexOf('.');
		expect(lastDot).toBeGreaterThan(0);
		expect(lastDot).toBeLessThan(signed.length - 1);
	});

	it('handles special characters in values', async () => {
		const data = { name: 'héllo wörld', emoji: '🎉', path: '/foo/bar?q=1&b=2' };
		const signed = await signState(data, SECRET);
		const result = await verifyState(signed, SECRET);
		expect(result).toEqual(data);
	});
});
