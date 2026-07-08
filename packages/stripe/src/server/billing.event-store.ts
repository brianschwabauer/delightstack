import type { WebhookEventStore } from './billing.config';

/**
 * Minimal structural interface for a `StripeEventStore` Durable Object
 * namespace binding (avoids a hard dependency on workers-types in app code).
 */
export interface StripeEventStoreNamespace {
	idFromName(name: string): unknown;
	get(id: unknown): {
		has(event_id: string): Promise<boolean>;
		add(event_id: string): Promise<void>;
	};
}

/**
 * Adapts a `StripeEventStore` Durable Object binding (exported from
 * `@delightstack/stripe/worker`) into a durable `webhook_event_store`, so
 * webhook deduplication survives across Worker isolates.
 *
 * ```ts
 * defineBillingConfig({
 *   ...,
 *   webhook_event_store: durableObjectEventStore(platform.env.STRIPE_EVENTS),
 * })
 * ```
 */
export function durableObjectEventStore(
	namespace: StripeEventStoreNamespace,
): WebhookEventStore {
	const stub = () => namespace.get(namespace.idFromName('stripe-webhook-events'));
	return {
		has: (event_id) => stub().has(event_id),
		add: (event_id) => stub().add(event_id),
	};
}
