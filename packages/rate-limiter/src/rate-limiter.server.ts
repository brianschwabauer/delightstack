import { DurableObject } from 'cloudflare:workers';

/** Configuration options for the rate limiter */
export interface RateLimiterOptions {
	/** The maximum number of tokens the bucket can hold */
	max_tokens?: number;
	/** How often one token is added to the bucket, in seconds */
	refill_every_seconds?: number;
}

/** Status of a rate limit bucket */
export interface RateLimiterStatus {
	/** Number of tokens currently available */
	remaining: number;
	/** Maximum tokens (bucket capacity) */
	limit: number;
	/** Milliseconds until the next token is added (0 if bucket is full) */
	reset_in_ms: number;
}

/** Internal representation of a token bucket */
interface TokenBucket {
	count: number;
	last_refill: number;
}

/**
 * A Durable Object that implements a rate limiter using a 'token bucket' algorithm.
 * A bucket is filled at a constant rate and can hold a maximum number of tokens.
 * Each request consumes a token (cost), and requests are rejected if the bucket is empty.
 * State is held in-memory only — when the Durable Object is evicted, all buckets reset.
 *
 * @example
 * const limiter_id = env.LIMITER.idFromName(ip_address);
 * const limiter = env.LIMITER.get(limiter_id);
 * await limiter.setOptions({ max_tokens: 10, refill_every_seconds: 10 });
 *
 * const is_allowed = await limiter.check('login_attempt', 1);
 * const consumed = await limiter.consume('login_attempt', 1);
 * const status = await limiter.getStatus('login_attempt');
 */
export class RateLimiterServer extends DurableObject {
	/** The maximum number of tokens in the bucket before it is full */
	private max_tokens = 10;

	/** The rate at which the bucket refills (adds one token every X seconds) */
	private refill_every_seconds = 10;

	/** In-memory storage for token buckets (intentionally not persisted) */
	private buckets = new Map<string, TokenBucket>();

	/** Sets the options for how the rate limiter should function */
	setOptions(options: RateLimiterOptions): void {
		if (options.max_tokens !== undefined) {
			this.max_tokens = options.max_tokens;
		}
		if (options.refill_every_seconds !== undefined) {
			this.refill_every_seconds = options.refill_every_seconds;
		}
	}

	/** Returns true if there are at least `cost` tokens available in the bucket for the given key */
	check(key: string, cost: number): boolean {
		const bucket = this.buckets.get(key);
		if (!bucket) return cost <= this.max_tokens;
		const now = Date.now();
		const refill_interval_ms = this.refill_every_seconds * 1000;
		const refills = Math.floor((now - bucket.last_refill) / refill_interval_ms);
		const current_count = Math.min(bucket.count + refills, this.max_tokens);
		return current_count >= cost;
	}

	/**
	 * Consumes `cost` tokens from the bucket for the given key.
	 * @returns true if the tokens were consumed, false if there were not enough tokens
	 */
	consume(key: string, cost: number): boolean {
		let bucket = this.buckets.get(key);
		const now = Date.now();

		if (!bucket) {
			if (cost > this.max_tokens) return false;
			bucket = { count: this.max_tokens - cost, last_refill: now };
			this.buckets.set(key, bucket);
			return true;
		}

		const refill_interval_ms = this.refill_every_seconds * 1000;
		const refills = Math.floor((now - bucket.last_refill) / refill_interval_ms);
		if (refills > 0) {
			bucket.count = Math.min(bucket.count + refills, this.max_tokens);
			bucket.last_refill += refills * refill_interval_ms;
		}

		if (bucket.count < cost) return false;
		bucket.count -= cost;
		return true;
	}

	/** Returns the current status of a rate limit bucket */
	getStatus(key: string): RateLimiterStatus {
		const bucket = this.buckets.get(key);
		const now = Date.now();

		if (!bucket) {
			return { remaining: this.max_tokens, limit: this.max_tokens, reset_in_ms: 0 };
		}

		const refill_interval_ms = this.refill_every_seconds * 1000;
		const refills = Math.floor((now - bucket.last_refill) / refill_interval_ms);
		const current_count = Math.min(bucket.count + refills, this.max_tokens);
		const ms_since_last_refill =
			now - bucket.last_refill - refills * refill_interval_ms;
		const reset_in_ms =
			current_count >= this.max_tokens
				? 0
				: refill_interval_ms - ms_since_last_refill;

		return { remaining: current_count, limit: this.max_tokens, reset_in_ms };
	}

	/** Resets a rate limit bucket, restoring it to full capacity on next access */
	reset(key: string): void {
		this.buckets.delete(key);
	}
}
