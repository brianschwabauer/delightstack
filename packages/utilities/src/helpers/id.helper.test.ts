import { describe, expect, it, vi } from 'vitest';
import { DelightError } from './error.helper';
import { generateTimestampID } from './id.helper';

const ALPHANUMERIC = /^[0-9A-Za-z]+$/;
const PUSH_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Decodes the base62 timestamp encoded in the first 8 characters of an ID */
function decodeTimestamp(id: string): number {
	let total = 0;
	for (let i = 0; i < 8; i++) total = total * 62 + PUSH_CHARS.indexOf(id.charAt(i));
	return total;
}

describe('generateTimestampID', () => {
	it('should default to 20 characters', () => {
		expect(generateTimestampID()).toHaveLength(20);
		expect(generateTimestampID({})).toHaveLength(20);
		expect(generateTimestampID({ length: undefined })).toHaveLength(20);
	});

	it('should only use alphanumeric characters', () => {
		expect(generateTimestampID()).toMatch(ALPHANUMERIC);
		expect(generateTimestampID({ length: 10 })).toMatch(ALPHANUMERIC);
	});

	it('should honor the requested length', () => {
		for (const length of [10, 11, 14, 20, 21, 64]) {
			expect(generateTimestampID({ length })).toHaveLength(length);
		}
	});

	it('should keep the first 8 characters as the timestamp regardless of length', () => {
		const now = Date.now();
		for (const length of [10, 20, 40]) {
			const id = generateTimestampID({ length });
			expect(decodeTimestamp(id)).toBeGreaterThanOrEqual(now);
			expect(decodeTimestamp(id)).toBeLessThan(now + 1000);
		}
	});

	it('should stay lexicographically sortable at any length', () => {
		// The clock is frozen so the in-request counter (not the wall clock) is
		// what has to keep the IDs ordered.
		vi.useFakeTimers();
		try {
			const ids = Array.from({ length: 500 }, () => generateTimestampID({ length: 14 }));
			expect(ids).toEqual([...ids].sort());
		} finally {
			vi.useRealTimers();
		}
	});

	it('should reject a length below the minimum', () => {
		expect(() => generateTimestampID({ length: 9 })).toThrow(DelightError);
		expect(() => generateTimestampID({ length: 0 })).toThrow(DelightError);
		expect(() => generateTimestampID({ length: -20 })).toThrow(DelightError);
	});

	it('should reject a non-integer length', () => {
		expect(() => generateTimestampID({ length: 20.5 })).toThrow(DelightError);
		expect(() => generateTimestampID({ length: Number.NaN })).toThrow(DelightError);
		expect(() => generateTimestampID({ length: Number.POSITIVE_INFINITY })).toThrow(
			DelightError,
		);
	});

	it('should throw a 400 DelightError with a code', () => {
		try {
			generateTimestampID({ length: 4 });
			expect.unreachable();
		} catch (error) {
			expect(DelightError.is(error)).toBe(true);
			expect((error as DelightError).status).toBe(400);
			expect((error as DelightError).code).toBe('INVALID_ID_LENGTH');
		}
	});

	it('should not collide across many IDs at the default length', () => {
		const ids = new Set(Array.from({ length: 10_000 }, () => generateTimestampID()));
		expect(ids.size).toBe(10_000);
	});
});
