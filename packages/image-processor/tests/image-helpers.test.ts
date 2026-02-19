// @ts-nocheck
import { describe, it, expect, vi } from 'vitest';

// Mock thumbhash
vi.mock('thumbhash', () => ({
	thumbHashToDataURL: vi.fn((hash: Uint8Array) => {
		// Return a deterministic data URL based on hash length
		return `data:image/png;base64,mock_${hash.length}`;
	}),
}));

import { decodeThumbHash, imageURL } from '../src/image-helpers';

describe('decodeThumbHash', () => {
	it('decodes base64 thumbhash to a data URL', () => {
		// Base64 of a 5-byte buffer
		const base64 = btoa(String.fromCharCode(1, 2, 3, 4, 5));
		const result = decodeThumbHash(base64);

		expect(result).toBe('data:image/png;base64,mock_5');
	});

	it('handles empty base64 string', () => {
		const base64 = btoa('');
		const result = decodeThumbHash(base64);

		expect(result).toBe('data:image/png;base64,mock_0');
	});

	it('passes correct Uint8Array to thumbHashToDataURL', async () => {
		const { thumbHashToDataURL } = await import('thumbhash');
		const bytes = new Uint8Array([10, 20, 30]);
		const base64 = btoa(String.fromCharCode(...bytes));

		decodeThumbHash(base64);

		expect(thumbHashToDataURL).toHaveBeenCalledWith(
			expect.any(Uint8Array),
		);
		const arg = (thumbHashToDataURL as any).mock.calls.at(-1)[0];
		expect(Array.from(arg)).toEqual([10, 20, 30]);
	});
});

describe('imageURL', () => {
	it('builds default URL', () => {
		const url = imageURL('abc123');
		expect(url).toBe('/cdn/image/abc123/default');
	});

	it('builds URL with custom variant', () => {
		const url = imageURL('abc123', 'thumbnail');
		expect(url).toBe('/cdn/image/abc123/thumbnail');
	});

	it('builds URL with original variant', () => {
		const url = imageURL('abc123', 'original');
		expect(url).toBe('/cdn/image/abc123/original');
	});

	it('builds URL with custom prefix', () => {
		const url = imageURL('abc123', 'default', '/images');
		expect(url).toBe('/images/abc123/default');
	});

	it('builds URL with custom prefix and variant', () => {
		const url = imageURL('abc123', 'thumbnail', '/api/media');
		expect(url).toBe('/api/media/abc123/thumbnail');
	});
});
