import type Stripe from 'stripe';
import type { ResolvedBillingConfig } from './billing.config';
import { getStripe, stripeCall } from './billing.stripe';

/** Track whether sync has been performed this lifecycle */
let products_synced = false;
let meters_synced = false;

/**
 * Syncs plan definitions to Stripe products and prices.
 * Uses lookup_keys so that prices can be updated without changing code references.
 * Idempotent — safe to call on every startup.
 *
 * Strategy:
 * - Products are matched by metadata.plan_id
 * - Prices are matched by lookup_key (Stripe's built-in mechanism)
 * - Existing resources are updated; missing ones are created
 * - Nothing is deleted (archived plans stay in Stripe)
 */
export async function syncProducts(config: ResolvedBillingConfig): Promise<void> {
	if (products_synced || !config.plans?.length) return;
	products_synced = true;

	const stripe = getStripe(config);

	for (const plan of config.plans) {
		// 1. Ensure product exists
		let product: Stripe.Product | undefined;

		// Search by metadata.plan_id
		const products = await stripeCall(() =>
			stripe.products.search({
				query: `metadata['plan_id']:'${plan.id}'`,
			}),
		);
		product = products.data[0];

		if (!product) {
			// Create new product
			product = await stripeCall(() =>
				stripe.products.create({
					name: plan.name,
					description: plan.description,
					metadata: { plan_id: plan.id, ...plan.metadata },
				}),
			);
		} else {
			// Update existing product
			await stripeCall(() =>
				stripe.products.update(product!.id, {
					name: plan.name,
					description: plan.description,
					active: !plan.archived,
					metadata: { plan_id: plan.id, ...plan.metadata },
				}),
			);
		}

		// 2. Ensure price exists with the correct lookup_key
		const prices = await stripeCall(() =>
			stripe.prices.list({ lookup_keys: [plan.lookup_key], limit: 1 }),
		);

		// One-time plans (no interval) create a non-recurring price
		const recurring = plan.interval
			? { interval: plan.interval, interval_count: plan.interval_count ?? 1 }
			: undefined;

		if (!prices.data.length) {
			// Create price with lookup_key
			await stripeCall(() =>
				stripe.prices.create({
					product: product!.id,
					unit_amount: plan.amount,
					currency: plan.currency ?? 'usd',
					...(recurring ? { recurring } : {}),
					lookup_key: plan.lookup_key,
					transfer_lookup_key: true,
					metadata: { plan_id: plan.id },
				}),
			);
		} else {
			// If price exists but amount/interval changed, create new price
			// and transfer the lookup_key
			const existing_price = prices.data[0];
			if (
				existing_price.unit_amount !== plan.amount ||
				(existing_price.recurring?.interval ?? undefined) !== plan.interval ||
				(plan.interval &&
					(existing_price.recurring?.interval_count ?? 1) !== (plan.interval_count ?? 1))
			) {
				await stripeCall(() =>
					stripe.prices.create({
						product: product!.id,
						unit_amount: plan.amount,
						currency: plan.currency ?? 'usd',
						...(recurring ? { recurring } : {}),
						lookup_key: plan.lookup_key,
						transfer_lookup_key: true,
						metadata: { plan_id: plan.id },
					}),
				);
			}
		}
	}
}

/**
 * Syncs meter definitions to Stripe Billing Meters.
 * Idempotent — creates meters that do not exist.
 */
export async function syncMeters(config: ResolvedBillingConfig): Promise<void> {
	if (meters_synced || !config.meters?.length) return;
	meters_synced = true;

	const stripe = getStripe(config);

	// List existing meters
	const existing = await stripeCall(() => stripe.billing.meters.list({ limit: 100 }));

	for (const meter of config.meters) {
		const found = existing.data.find((m) => m.event_name === meter.event_name);
		if (!found) {
			await stripeCall(() =>
				stripe.billing.meters.create({
					display_name: meter.display_name,
					event_name: meter.event_name,
					default_aggregation: {
						formula: meter.aggregation as 'sum' | 'count',
					},
					customer_mapping: {
						type: 'by_id',
						event_payload_key: 'stripe_customer_id',
					},
					value_settings: {
						event_payload_key: meter.value_key ?? 'value',
					},
				}),
			);
		}
	}
}

/**
 * Run a full sync of products, prices, and meters.
 * Called automatically on first request if `sync_on_startup` is enabled.
 */
export async function syncAll(config: ResolvedBillingConfig): Promise<void> {
	await syncProducts(config);
	await syncMeters(config);
}
