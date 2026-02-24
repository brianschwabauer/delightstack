import { describe, it, expect } from 'vitest';
import { encodePermissions, decodePermissions } from './auth.type';

const permissions = ['read', 'write', 'admin', 'owner'] as const;

describe('encodePermissions', () => {
	it('encodes a single permission', () => {
		expect(encodePermissions(permissions, ['read'])).toBe(0b0001);
		expect(encodePermissions(permissions, ['write'])).toBe(0b0010);
		expect(encodePermissions(permissions, ['admin'])).toBe(0b0100);
		expect(encodePermissions(permissions, ['owner'])).toBe(0b1000);
	});

	it('encodes multiple permissions', () => {
		expect(encodePermissions(permissions, ['read', 'write'])).toBe(0b0011);
		expect(encodePermissions(permissions, ['read', 'admin'])).toBe(0b0101);
		expect(encodePermissions(permissions, ['read', 'write', 'admin', 'owner'])).toBe(0b1111);
	});

	it('returns 0 for empty values', () => {
		expect(encodePermissions(permissions, [])).toBe(0);
	});

	it('ignores unknown permission names', () => {
		expect(encodePermissions(permissions, ['read', 'nonexistent' as never])).toBe(0b0001);
	});

	it('handles duplicate values', () => {
		expect(encodePermissions(permissions, ['read', 'read'])).toBe(0b0001);
	});
});

describe('decodePermissions', () => {
	it('decodes a single permission bit', () => {
		expect(decodePermissions(permissions, 0b0001)).toEqual(['read']);
		expect(decodePermissions(permissions, 0b0010)).toEqual(['write']);
		expect(decodePermissions(permissions, 0b0100)).toEqual(['admin']);
		expect(decodePermissions(permissions, 0b1000)).toEqual(['owner']);
	});

	it('decodes multiple permission bits', () => {
		expect(decodePermissions(permissions, 0b0011)).toEqual(['read', 'write']);
		expect(decodePermissions(permissions, 0b1111)).toEqual(['read', 'write', 'admin', 'owner']);
	});

	it('returns empty array for 0', () => {
		expect(decodePermissions(permissions, 0)).toEqual([]);
	});

	it('ignores bits beyond the permissions array', () => {
		// 0b10001 has bit 4 set, but permissions only has 4 entries (indices 0-3)
		expect(decodePermissions(permissions, 0b10001)).toEqual(['read']);
	});

	it('roundtrips with encodePermissions', () => {
		const values = ['read', 'admin'] as const;
		const encoded = encodePermissions(permissions, [...values]);
		const decoded = decodePermissions(permissions, encoded);
		expect(decoded).toEqual(['read', 'admin']);
	});
});
