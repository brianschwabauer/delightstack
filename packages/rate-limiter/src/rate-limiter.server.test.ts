import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiterServer } from './rate-limiter.server';

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	}
	return { DurableObject };
});

function createLimiter(): RateLimiterServer {
	return new RateLimiterServer({} as DurableObjectState, {});
}

describe('RateLimiterServer', () => {
	let limiter: RateLimiterServer;

	beforeEach(() => {
		vi.useRealTimers();
		limiter = createLimiter();
	});

	describe('default behavior', () => {
		it('check() returns true for a new key with cost <= max_tokens', () => {
			expect(limiter.check('key', 1)).toBe(true);
			expect(limiter.check('key', 10)).toBe(true);
		});

		it('check() returns false for a new key with cost > max_tokens', () => {
			expect(limiter.check('key', 11)).toBe(false);
			expect(limiter.check('key', 100)).toBe(false);
		});

		it('consume() returns true for a new key with cost <= max_tokens', () => {
			expect(limiter.consume('key', 1)).toBe(true);
		});

		it('consume() returns false for a new key with cost > max_tokens', () => {
			expect(limiter.consume('key', 11)).toBe(false);
		});

		it('consume() with cost equal to max_tokens depletes the bucket exactly', () => {
			expect(limiter.consume('key', 10)).toBe(true);
			expect(limiter.check('key', 1)).toBe(false);
		});
	});

	describe('token depletion', () => {
		it('consuming all tokens causes check() to return false', () => {
			for (let i = 0; i < 10; i++) {
				expect(limiter.consume('key', 1)).toBe(true);
			}
			expect(limiter.check('key', 1)).toBe(false);
		});

		it('consuming all tokens causes consume() to return false', () => {
			limiter.consume('key', 10);
			expect(limiter.consume('key', 1)).toBe(false);
		});

		it('partial consumption tracks remaining tokens correctly', () => {
			limiter.consume('key', 7);
			expect(limiter.check('key', 3)).toBe(true);
			expect(limiter.check('key', 4)).toBe(false);
		});
	});

	describe('token refill', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		it('refills one token after refill_every_seconds', () => {
			limiter.consume('key', 10);
			expect(limiter.check('key', 1)).toBe(false);

			vi.advanceTimersByTime(10_000);
			expect(limiter.check('key', 1)).toBe(true);
			expect(limiter.check('key', 2)).toBe(false);
		});

		it('refills fully after max_tokens * refill_every_seconds', () => {
			limiter.consume('key', 10);

			vi.advanceTimersByTime(100_000);
			expect(limiter.check('key', 10)).toBe(true);
		});

		it('does not exceed max_tokens after long idle', () => {
			limiter.consume('key', 5);

			vi.advanceTimersByTime(1_000_000);
			const status = limiter.getStatus('key');
			expect(status.remaining).toBe(10);
		});

		it('preserves sub-interval progress toward next refill', () => {
			limiter.consume('key', 10);

			// Advance 15 seconds (1.5 refill intervals)
			vi.advanceTimersByTime(15_000);
			// Should have 1 token (not 1.5, floor is used)
			expect(limiter.consume('key', 1)).toBe(true);
			expect(limiter.check('key', 1)).toBe(false);

			// Advance 5 more seconds — completes the remaining half-interval
			vi.advanceTimersByTime(5_000);
			expect(limiter.check('key', 1)).toBe(true);
		});

		it('rapid consume calls do not reset the refill timer', () => {
			limiter.consume('key', 9);

			// Rapid consume within the refill window
			vi.advanceTimersByTime(1_000);
			limiter.consume('key', 0);
			vi.advanceTimersByTime(1_000);
			limiter.consume('key', 0);

			// At t=10s, 1 token should be refilled regardless of intermediate consume calls
			vi.advanceTimersByTime(8_000);
			expect(limiter.check('key', 2)).toBe(true);
		});
	});

	describe('setOptions()', () => {
		it('max_tokens limits the bucket capacity', () => {
			limiter.setOptions({ max_tokens: 5 });
			expect(limiter.check('key', 5)).toBe(true);
			expect(limiter.check('key', 6)).toBe(false);
		});

		it('refill_every_seconds changes the refill rate', () => {
			vi.useFakeTimers();
			limiter.setOptions({ refill_every_seconds: 1 });
			limiter.consume('key', 10);

			vi.advanceTimersByTime(1_000);
			expect(limiter.check('key', 1)).toBe(true);
		});

		it('setting only one option does not reset the other', () => {
			limiter.setOptions({ max_tokens: 5 });
			limiter.setOptions({ refill_every_seconds: 1 });
			// max_tokens should still be 5
			expect(limiter.check('key', 5)).toBe(true);
			expect(limiter.check('key', 6)).toBe(false);
		});

		it('calling setOptions({}) changes nothing', () => {
			limiter.setOptions({});
			expect(limiter.check('key', 10)).toBe(true);
			expect(limiter.check('key', 11)).toBe(false);
		});
	});

	describe('getStatus()', () => {
		it('returns full capacity for a new key', () => {
			const status = limiter.getStatus('key');
			expect(status).toEqual({
				remaining: 10,
				limit: 10,
				reset_in_ms: 0,
			});
		});

		it('returns correct remaining after consumption', () => {
			limiter.consume('key', 3);
			const status = limiter.getStatus('key');
			expect(status.remaining).toBe(7);
			expect(status.limit).toBe(10);
		});

		it('returns correct reset_in_ms mid-refill', () => {
			vi.useFakeTimers();
			limiter.consume('key', 5);

			vi.advanceTimersByTime(3_000);
			const status = limiter.getStatus('key');
			expect(status.remaining).toBe(5);
			expect(status.reset_in_ms).toBe(7_000);
		});

		it('returns reset_in_ms of 0 when bucket is full', () => {
			vi.useFakeTimers();
			limiter.consume('key', 1);

			vi.advanceTimersByTime(10_000);
			const status = limiter.getStatus('key');
			expect(status.remaining).toBe(10);
			expect(status.reset_in_ms).toBe(0);
		});

		it('reflects custom options', () => {
			limiter.setOptions({ max_tokens: 20 });
			const status = limiter.getStatus('key');
			expect(status).toEqual({
				remaining: 20,
				limit: 20,
				reset_in_ms: 0,
			});
		});
	});

	describe('reset()', () => {
		it('restores a depleted bucket to full capacity', () => {
			limiter.consume('key', 10);
			expect(limiter.check('key', 1)).toBe(false);

			limiter.reset('key');
			expect(limiter.check('key', 10)).toBe(true);
		});

		it('is a no-op for a non-existent key', () => {
			expect(() => limiter.reset('nonexistent')).not.toThrow();
		});
	});

	describe('multiple keys', () => {
		it('keys are independent', () => {
			limiter.consume('a', 10);
			expect(limiter.check('a', 1)).toBe(false);
			expect(limiter.check('b', 10)).toBe(true);
		});

		it('consuming from one key does not affect another', () => {
			limiter.consume('a', 5);
			limiter.consume('b', 3);
			expect(limiter.getStatus('a').remaining).toBe(5);
			expect(limiter.getStatus('b').remaining).toBe(7);
		});
	});

	describe('edge cases', () => {
		it('cost of 0 always returns true for check()', () => {
			expect(limiter.check('key', 0)).toBe(true);
			limiter.consume('key', 10);
			expect(limiter.check('key', 0)).toBe(true);
		});

		it('cost of 0 always returns true for consume()', () => {
			expect(limiter.consume('key', 0)).toBe(true);
			limiter.consume('key', 10);
			expect(limiter.consume('key', 0)).toBe(true);
		});
	});
});
