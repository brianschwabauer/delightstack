import type { ResolvedBillingConfig } from './billing.config';
import { getStripe, stripeCall } from './billing.stripe';
import { DelightError } from '@delightstack/utilities';

/**
 * Reports a usage event to a Stripe Billing Meter.
 *
 * @example
 * ```ts
 * await reportMeterEvent(config, {
 *   meter_id: 'ai-tokens',
 *   customer_id: 'cus_xxx',
 *   value: result.usage.total_tokens,
 * });
 * ```
 */
export async function reportMeterEvent(
	config: ResolvedBillingConfig,
	options: {
		/** The meter ID (matches MeterDefinition.id from config) */
		meter_id: string;
		/** The Stripe customer ID to attribute the usage to */
		customer_id: string;
		/** The usage value to report */
		value: number;
		/** Unix timestamp in seconds @default now */
		timestamp?: number;
		/** Idempotency key to prevent duplicate events */
		idempotency_key?: string;
	},
): Promise<void> {
	const meter_def = config.meters?.find((m) => m.id === options.meter_id);
	if (!meter_def) {
		throw DelightError.badRequest(`Unknown meter: ${options.meter_id}`);
	}

	const stripe = getStripe(config);

	await stripeCall(() =>
		stripe.billing.meterEvents.create(
			{
				event_name: meter_def.event_name,
				payload: {
					stripe_customer_id: options.customer_id,
					[meter_def.value_key ?? 'value']: String(options.value),
				},
				timestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
			},
			options.idempotency_key ? { idempotencyKey: options.idempotency_key } : undefined,
		),
	);
}

/**
 * Creates a helper function bound to a specific meter and config.
 * Designed for integration with the AI package.
 *
 * @example
 * ```ts
 * // In your Durable Object:
 * const reportTokenUsage = createMeterReporter(billingConfig, 'ai-tokens');
 *
 * // After each AI completion:
 * const result = await ai.complete(options);
 * await reportTokenUsage(customer_id, result.usage.total_tokens);
 * ```
 */
export function createMeterReporter(config: ResolvedBillingConfig, meter_id: string) {
	return async (
		customer_id: string,
		value: number,
		idempotency_key?: string,
	): Promise<void> => {
		if (value <= 0) return; // Skip zero/negative usage
		await reportMeterEvent(config, {
			meter_id,
			customer_id,
			value,
			idempotency_key,
		});
	};
}
