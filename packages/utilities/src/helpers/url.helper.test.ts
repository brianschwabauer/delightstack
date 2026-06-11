import { describe, expect, it } from 'vitest';
import { decodeWebsafeBase64, encodeWebsafeBase64 } from './url.helper';

describe('websafe base64', () => {
	it('round-trips plain strings', () => {
		const input = 'hello world';
		expect(decodeWebsafeBase64(encodeWebsafeBase64(input))).toBe(input);
	});

	it('round-trips strings whose base64 contains + and / (the websafe substitutions)', () => {
		// '>>>???' encodes to 'Pj4+Pz8/' in standard base64 — exercises both '+' and '/'
		const input = '>>>???';
		const encoded = encodeWebsafeBase64(input);
		expect(encoded).not.toContain('+');
		expect(encoded).not.toContain('/');
		expect(decodeWebsafeBase64(encoded)).toBe(input);
	});

	it('round-trips binary-ish strings', () => {
		const input = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i % 128));
		expect(decodeWebsafeBase64(encodeWebsafeBase64(input))).toBe(input);
	});
});
