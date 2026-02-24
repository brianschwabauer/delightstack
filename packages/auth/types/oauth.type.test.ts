import { describe, it, expect } from 'vitest';
import { encodeOauthScopes, decodeOauthScopes } from './oauth.type';

const scopes = ['profile', 'email', 'calendar', 'contacts'] as const;

describe('encodeOauthScopes', () => {
	it('encodes a single scope', () => {
		expect(encodeOauthScopes(scopes, ['profile'])).toBe(0b0001);
		expect(encodeOauthScopes(scopes, ['email'])).toBe(0b0010);
		expect(encodeOauthScopes(scopes, ['calendar'])).toBe(0b0100);
	});

	it('encodes multiple scopes', () => {
		expect(encodeOauthScopes(scopes, ['profile', 'email'])).toBe(0b0011);
		expect(encodeOauthScopes(scopes, ['profile', 'email', 'calendar', 'contacts'])).toBe(0b1111);
	});

	it('returns 0 for empty values', () => {
		expect(encodeOauthScopes(scopes, [])).toBe(0);
	});

	it('ignores unknown scope names', () => {
		expect(encodeOauthScopes(scopes, ['profile', 'unknown' as never])).toBe(0b0001);
	});
});

describe('decodeOauthScopes', () => {
	it('decodes scope bits', () => {
		expect(decodeOauthScopes(scopes, 0b0001)).toEqual(['profile']);
		expect(decodeOauthScopes(scopes, 0b0011)).toEqual(['profile', 'email']);
		expect(decodeOauthScopes(scopes, 0b1111)).toEqual(['profile', 'email', 'calendar', 'contacts']);
	});

	it('returns empty array for 0', () => {
		expect(decodeOauthScopes(scopes, 0)).toEqual([]);
	});

	it('roundtrips with encodeOauthScopes', () => {
		const values = ['email', 'contacts'] as const;
		const encoded = encodeOauthScopes(scopes, [...values]);
		const decoded = decodeOauthScopes(scopes, encoded);
		expect(decoded).toEqual(['email', 'contacts']);
	});
});
