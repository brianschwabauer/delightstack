import { DurableObject } from 'cloudflare:workers';

/**
 * How long processed event ids are remembered. Stripe retries failed webhook
 * deliveries for up to 3 days, so the durable store must remember longer than
 * that (unlike the in-memory default's 24h, which only has to survive between
 * near-term retries).
 */
const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Durable Object storage.delete() accepts at most 128 keys per call */
const DELETE_BATCH_SIZE = 128;

/**
 * Minimal Durable Object that remembers processed Stripe webhook event ids,
 * so webhook deduplication survives across Worker isolates (the in-memory
 * default store is per-isolate and lets Stripe retries double-fire hooks on
 * multi-isolate deployments).
 *
 * Usage — export it from your Worker entry, bind it, and pass the adapter:
 *
 * ```ts
 * // worker entry
 * export { StripeEventStore } from '@delightstack/stripe/worker';
 * ```
 *
 * ```jsonc
 * // wrangler config
 * "durable_objects": { "bindings": [{ "name": "STRIPE_EVENTS", "class_name": "StripeEventStore" }] },
 * "migrations": [{ "tag": "...", "new_sqlite_classes": ["StripeEventStore"] }]
 * ```
 *
 * ```ts
 * // billing config
 * webhook_event_store: durableObjectEventStore(platform.env.STRIPE_EVENTS)
 * ```
 *
 * Expired ids are pruned by an alarm that re-arms while entries remain.
 */
export class StripeEventStore extends DurableObject {
	/** Returns true if the given Stripe event id was already processed */
	async has(event_id: string): Promise<boolean> {
		return (await this.ctx.storage.get(event_id)) !== undefined;
	}

	/** Marks the given Stripe event id as processed */
	async add(event_id: string): Promise<void> {
		await this.ctx.storage.put(event_id, Date.now());
		// Arm the cleanup alarm if one isn't already scheduled
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + EVENT_TTL_MS);
		}
	}

	/** Prunes expired event ids; re-arms while any entries remain */
	async alarm(): Promise<void> {
		const now = Date.now();
		const entries = await this.ctx.storage.list<number>();
		const expired: string[] = [];
		for (const [key, added_at] of entries) {
			if (now - added_at > EVENT_TTL_MS) expired.push(key);
		}
		for (let i = 0; i < expired.length; i += DELETE_BATCH_SIZE) {
			await this.ctx.storage.delete(expired.slice(i, i + DELETE_BATCH_SIZE));
		}
		if (entries.size > expired.length) {
			await this.ctx.storage.setAlarm(now + EVENT_TTL_MS);
		}
	}
}
