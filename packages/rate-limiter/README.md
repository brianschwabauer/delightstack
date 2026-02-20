# @delightstack/rate-limiter

Token bucket rate limiter for Cloudflare Workers, implemented as a Durable Object with zero runtime dependencies. Configure limits per key (IP address, user ID, API key, etc.) and let the single-instance guarantee handle concurrency for you.

## Features

- **Token bucket algorithm** -- A bucket fills at a constant rate and holds a maximum number of tokens. Each request consumes tokens, and requests are rejected when the bucket is empty.
- **Key-based tracking** -- Each Durable Object instance manages multiple independent buckets by key, so you can rate limit different actions (login, API calls, uploads) separately within the same limiter.
- **Native DO RPC** -- All methods are called directly via Durable Object RPC. No fetch handlers, no serialization boilerplate.
- **Status for response headers** -- `getStatus()` returns `remaining`, `limit`, and `reset_in_ms`, ready to populate `X-RateLimit-*` headers.
- **In-memory only** -- Bucket state is intentionally not persisted. When the Durable Object is evicted from memory, all limits reset. This is appropriate for rate limiting because transient state is acceptable -- a brief reset after eviction is far better than the complexity and latency of durable storage.
- **Zero dependencies** -- Only imports `cloudflare:workers`. No external packages.

## Architecture

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                     Your Cloudflare Worker                      │
  │                                                                 │
  │  const id = env.LIMITER.idFromName(ip_address);                 │
  │  const limiter = env.LIMITER.get(id);                           │
  │  const allowed = await limiter.consume('api', 1);               │
  │                            │                                    │
  └────────────────────────────┼────────────────────────────────────┘
                               │ DO RPC (direct method call)
                               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │               RateLimiterServer (Durable Object)                │
  │                                                                 │
  │  ┌─────────────────────────────────────────────────────┐        │
  │  │              In-Memory Bucket Map                   │        │
  │  │                                                     │        │
  │  │  "api"     → { count: 7, last_refill: 1708300000 }  │        │
  │  │  "login"   → { count: 0, last_refill: 1708300050 }  │        │
  │  │  "upload"  → { count: 3, last_refill: 1708300020 }  │        │
  │  └─────────────────────────────────────────────────────┘        │
  │                                                                 │
  │  setOptions()  check()  consume()  getStatus()  reset()         │
  └─────────────────────────────────────────────────────────────────┘
```

**One instance per identity.** You choose the Durable Object ID via `idFromName()`. Use an IP address for per-IP limiting, a user ID for per-user limiting, or a fixed string like `"global"` for a global rate limit. Cloudflare guarantees a single instance per ID, so there are no race conditions between concurrent requests.

**Multiple buckets per instance.** Within each DO instance, the `key` parameter (e.g. `"login"`, `"api"`, `"upload"`) indexes into separate token buckets. This lets you enforce different limits for different actions without creating separate DO instances.

## Quickstart

### 1. Re-export the Durable Object

In your Worker entry point, re-export the class so Cloudflare can instantiate it:

```typescript
export { RateLimiterServer } from '@delightstack/rate-limiter';
```

### 2. Add to `wrangler.toml`

```toml
[[durable_objects.bindings]]
name = "LIMITER"
class_name = "RateLimiterServer"

[[migrations]]
tag = "v1"
new_classes = ["RateLimiterServer"]
```

### 3. Use in your Worker

```typescript
export default {
	async fetch(request: Request, env: Env) {
		const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
		const limiter = env.LIMITER.get(env.LIMITER.idFromName(ip));

		// Configure: 10 requests per 60 seconds
		await limiter.setOptions({ max_tokens: 10, refill_every_seconds: 60 });

		// Try to consume a token
		const allowed = await limiter.consume('api', 1);
		if (!allowed) {
			const status = await limiter.getStatus('api');
			return new Response('Too Many Requests', {
				status: 429,
				headers: {
					'Retry-After': String(Math.ceil(status.reset_in_ms / 1000)),
					'X-RateLimit-Limit': String(status.limit),
					'X-RateLimit-Remaining': String(status.remaining),
				},
			});
		}

		return new Response('OK');
	},
};
```

## How the Token Bucket Works

```
Time ──────────────────────────────────────────────────────────►

max_tokens = 5, refill_every_seconds = 10

Bucket:  [■ ■ ■ ■ ■]  5/5 tokens (full)
              │
         consume('api', 2)
              │
         [■ ■ ■ · ·]  3/5 tokens
              │
         consume('api', 1)
              │
         [■ ■ · · ·]  2/5 tokens
              │
         ── 10 seconds pass ──
              │
         [■ ■ ■ · ·]  3/5 tokens (+1 refilled)
              │
         ── 20 seconds pass ──
              │
         [■ ■ ■ ■ ■]  5/5 tokens (capped at max)
              │
         consume('api', 6)  → false (cost exceeds capacity)
```

Tokens refill one at a time at a fixed interval. The refill is calculated lazily on each `check()` or `consume()` call rather than using timers, so there is no background overhead. Sub-interval progress is preserved -- if 15 seconds pass with a 10-second interval, one token is added and the remaining 5 seconds count toward the next token.

## API Reference

### `setOptions(options: RateLimiterOptions): void`

Configures the rate limiter. Only the provided fields are updated; omitted fields keep their current values.

```typescript
interface RateLimiterOptions {
	/** Maximum tokens the bucket can hold (default: 10) */
	max_tokens?: number;
	/** Seconds between each token refill (default: 10) */
	refill_every_seconds?: number;
}
```

```typescript
// Set both
await limiter.setOptions({ max_tokens: 100, refill_every_seconds: 60 });

// Update only one (the other keeps its current value)
await limiter.setOptions({ max_tokens: 50 });
```

### `check(key: string, cost: number): boolean`

Returns `true` if the bucket has at least `cost` tokens available. Does **not** consume any tokens. Use this when you want to inspect the limit without affecting it.

```typescript
const can_proceed = await limiter.check('login', 1);
```

### `consume(key: string, cost: number): boolean`

Attempts to consume `cost` tokens from the bucket. Returns `true` if the tokens were consumed, `false` if there were not enough tokens (no tokens are consumed on failure).

```typescript
const allowed = await limiter.consume('api', 1);
if (!allowed) {
	return new Response('Too Many Requests', { status: 429 });
}
```

### `getStatus(key: string): RateLimiterStatus`

Returns the current state of a bucket. Useful for populating rate-limit response headers.

```typescript
interface RateLimiterStatus {
	/** Tokens currently available */
	remaining: number;
	/** Maximum tokens (bucket capacity) */
	limit: number;
	/** Milliseconds until the next token is added (0 if full) */
	reset_in_ms: number;
}
```

```typescript
const status = await limiter.getStatus('api');
response.headers.set('X-RateLimit-Limit', String(status.limit));
response.headers.set('X-RateLimit-Remaining', String(status.remaining));
response.headers.set('X-RateLimit-Reset', String(Math.ceil(status.reset_in_ms / 1000)));
```

### `reset(key: string): void`

Clears a bucket, restoring it to full capacity on the next access. Useful for unlocking a user after a password reset or admin action.

```typescript
await limiter.reset('login');
```

## Usage Patterns

### Per-IP rate limiting

```typescript
const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
const limiter = env.LIMITER.get(env.LIMITER.idFromName(ip));
await limiter.setOptions({ max_tokens: 60, refill_every_seconds: 1 });
const allowed = await limiter.consume('request', 1);
```

### Per-user with separate limits per action

```typescript
const limiter = env.LIMITER.get(env.LIMITER.idFromName(user.id));
await limiter.setOptions({ max_tokens: 100, refill_every_seconds: 60 });

// Different keys for different actions within the same limiter
await limiter.consume('api', 1); // 100 API calls/minute
await limiter.consume('upload', 10); // 10 uploads/minute (costs 10 tokens each)
```

### Login brute-force protection

```typescript
const limiter = env.LIMITER.get(env.LIMITER.idFromName(ip));
await limiter.setOptions({ max_tokens: 5, refill_every_seconds: 300 });

// Check before attempting login
const allowed = await limiter.check('login', 1);
if (!allowed) {
	return new Response('Too many login attempts. Try again later.', { status: 429 });
}

// Only consume on failed attempt
const success = await authenticate(email, password);
if (!success) {
	await limiter.consume('login', 1);
}
```

### Weighted costs

```typescript
// Different operations cost different amounts of tokens
await limiter.consume('api', 1); // Read: 1 token
await limiter.consume('api', 5); // Write: 5 tokens
await limiter.consume('api', 10); // Bulk operation: 10 tokens
```

## Design Decisions

### Why in-memory only (no persistence)

Rate limiting is inherently temporal. Persisting bucket state to SQLite would add write latency on every request and create unnecessary I/O for data that is meant to expire. When a Durable Object is evicted (typically after 30-60 seconds of inactivity), all limits reset. This is acceptable because:

- If traffic stops long enough for eviction, the user has effectively waited out their rate limit anyway.
- Cold-start penalty is negligible (~1-2ms for DO instantiation).
- The simplicity of in-memory state eliminates an entire class of bugs around stale/corrupt persisted counters.

### Why token bucket (not sliding window or fixed window)

Token bucket allows bursts up to the bucket capacity while maintaining a long-term average rate. A fixed window has the "boundary problem" where a user can make 2x the limit at the boundary between two windows. A sliding window log is more precise but requires storing every request timestamp. Token bucket strikes the best balance of accuracy, simplicity, and memory efficiency -- each bucket is just two numbers (count + timestamp).

### Why lazy refill calculation (not timers)

Tokens are not refilled in real-time. Instead, on each `check()` or `consume()` call, the elapsed time since `last_refill` is used to calculate how many tokens should have been added. This is mathematically equivalent to real-time refilling but avoids background timers, alarm scheduling, or periodic wake-ups. The DO can sleep freely and compute the correct state on demand.

### Why one DO per identity (not one global DO)

Using `idFromName(ip_address)` creates one DO instance per IP. A single global DO would serialize all rate-limit checks across all users, creating a bottleneck. Per-identity DOs distribute load across Cloudflare's network and run close to the user's region for lower latency.

## Exports

| Export               | Description                                     |
| -------------------- | ----------------------------------------------- |
| `RateLimiterServer`  | Durable Object class -- re-export from your app |
| `RateLimiterOptions` | Type for `setOptions()` parameter               |
| `RateLimiterStatus`  | Type for `getStatus()` return value             |

## Project Structure

```
packages/rate-limiter/
  package.json
  tsconfig.json
  vite.config.ts
  src/
    index.ts                        # Barrel export
    rate-limiter.server.ts          # RateLimiterServer class
    rate-limiter.server.test.ts     # Tests (28 cases)
```
