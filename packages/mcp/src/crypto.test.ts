import { describe, expect, it } from 'vitest';
import {
	base64UrlEncode,
	hashToken,
	randomToken,
	sha256Base64Url,
	timingSafeEqual,
} from './crypto.js';

describe('base64UrlEncode', () => {
	it('matches btoa with the URL alphabet and no padding', () => {
		for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'hello world', '?~>>>']) {
			const bytes = new TextEncoder().encode(text);
			const expected = btoa(text)
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/, '');
			expect(base64UrlEncode(bytes)).toBe(expected);
		}
	});

	it('emits nothing but the URL-safe alphabet for arbitrary bytes', () => {
		const bytes = new Uint8Array(256).map((_, i) => i);
		expect(base64UrlEncode(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe('randomToken', () => {
	it('is URL safe and does not repeat', () => {
		const seen = new Set(Array.from({ length: 500 }, () => randomToken(32)));
		expect(seen.size).toBe(500);
		for (const token of seen) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe('sha256Base64Url', () => {
	it('produces the PKCE S256 challenge from RFC 7636 appendix B', async () => {
		// The verifier and its expected challenge, verbatim from the RFC.
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
		expect(await sha256Base64Url(verifier)).toBe(challenge);
	});

	it('is stable and collision-free across inputs', async () => {
		expect(await sha256Base64Url('a')).toBe(await sha256Base64Url('a'));
		expect(await sha256Base64Url('a')).not.toBe(await sha256Base64Url('b'));
	});
});

describe('hashToken', () => {
	it('never returns the token it was given', async () => {
		const token = randomToken(32);
		expect(await hashToken(token)).not.toBe(token);
	});
});

describe('timingSafeEqual', () => {
	it('compares equal and unequal strings correctly', () => {
		expect(timingSafeEqual('abc', 'abc')).toBe(true);
		expect(timingSafeEqual('abc', 'abd')).toBe(false);
		expect(timingSafeEqual('abc', 'abcd')).toBe(false);
		expect(timingSafeEqual('', '')).toBe(true);
	});
});
