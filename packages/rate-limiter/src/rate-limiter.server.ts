import { ApiError } from '@packages/lib';
import { DurableObject } from 'cloudflare:workers';

/**
 * A Durable Object that implements a rate limiter using a 'token bucket' algorithm.
 * A bucket is filled at a constant rate and can hold a maximum number of tokens.
 * Each request consumes a token (cost), and requests are rejected if the bucket is empty.
 * We don't save the rate limiting to the database because when the durable object is evicted from memory,
 * the rate limiting will be reset. This is fine because the rate limiting is meant to be temporary.
 * @example
 * const limiter_id = this.LIMITER.idFromName(ip_address); // use ip address or user_id or some other unique identifier
 * const limiter = this.LIMITER.get(limiter_id);
 * limiter.max_tokens = 10;
 * limiter.refill_every_seconds = 10;
 * // Check if the request is allowed
 * const is_allowed = limiter.check('login_attempt', 1);
 * // On a login attempt, consume a token
 * limiter.consume('login_attempt', 1);
 */
export class RateLimiterServer extends DurableObject {
	/** The maximum about of items in the 'bucket' before it's full */
	private max_tokens = 10;

	/** The rate at which the bucket refills (adds one token every X seconds) */
	private refill_every_seconds = 10;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	private storage = new Map<string, { count: number; last_refill: number }>();

	/** The fetch event handler that should only be called in protected environments */
	async fetch(input: string | URL | Request, init?: RequestInit) {
		const url = input instanceof Request ? new URL(input.url) : new URL(input);
		const method = input instanceof Request ? input.method : init?.method || 'GET';
		if (url.pathname === '/rpc' && method === 'POST') {
			const body: any = await (input instanceof Request ? input.json() : init?.body);
			if (body?.method && body?.args && body.method in this) {
				try {
					const result = (this as any)[body.method](...body.args);
					const response = result instanceof Promise ? await result : result;
					return new Response(JSON.stringify(response), {
						headers: { 'content-type': 'application/json' },
					});
				} catch (error: any) {
					const responseError = ApiError.from(error);
					return new Response(responseError.toJSON(), {
						status: responseError.status || 500,
						headers: { 'content-type': 'application/json' },
					});
				}
			}
		}
		return new Response(JSON.stringify({ status: 404, message: 'Not found' }), {
			status: 404,
		});
	}

	/** Sets the options for how the rate limiter should function */
	setOptions(options?: { max_tokens?: number; refill_every_seconds?: number }) {
		this.max_tokens = options?.max_tokens ?? 10;
		this.refill_every_seconds = options?.refill_every_seconds ?? 10;
	}

	/** Return true if there are at least 'cost' amount of tokens in the bucket with the given key */
	check(key: string, cost: number): boolean {
		const bucket = this.storage.get(key) ?? null;
		if (bucket === null) return true;
		const now = Date.now();
		const refill = Math.floor(
			(now - bucket.last_refill) / (this.refill_every_seconds * 1000),
		);
		if (refill > 0) {
			return Math.min(bucket.count + refill, this.max_tokens) >= cost;
		}
		return bucket.count >= cost;
	}

	/**
	 * Uses up 'cost' amount of tokens in the bucket with the given key
	 * @returns true if the request is allowed, false if the bucket is empty (after the consumption)
	 */
	consume(key: string, cost: number): boolean {
		let bucket = this.storage.get(key) ?? null;
		const now = Date.now();
		if (bucket === null) {
			bucket = {
				count: this.max_tokens - cost,
				last_refill: now,
			};
			this.storage.set(key, bucket);
			return true;
		}
		const refill = Math.floor(
			(now - bucket.last_refill) / (this.refill_every_seconds * 1000),
		);
		bucket.count = Math.min(bucket.count + refill, this.max_tokens);
		bucket.last_refill = now;
		if (bucket.count < cost) return false;
		bucket.count -= cost;
		this.storage.set(key, bucket);
		return true;
	}
}
