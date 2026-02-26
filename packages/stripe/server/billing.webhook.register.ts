import type Stripe from 'stripe';
import type { ResolvedBillingConfig } from './billing.config';
import { getStripe, stripeCall } from './billing.stripe';

/** Webhook events the billing system needs to listen to */
const REQUIRED_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'invoice.paid',
	'invoice.payment_failed',
	'invoice.finalized',
	'checkout.session.completed',
	'customer.created',
	'customer.updated',
	'payment_method.attached',
	'payment_method.detached',
];

/**
 * Ensures a webhook endpoint is registered in Stripe for this app.
 * Called automatically on first webhook request if webhook_secret is not provided.
 *
 * In dev mode: deletes any existing webhook with the same URL and creates a fresh one.
 * In production: warns that webhook_secret should be configured.
 *
 * Returns the webhook signing secret.
 */
export async function ensureWebhookRegistered(
	config: ResolvedBillingConfig,
	app_url: string,
): Promise<string> {
	const stripe = getStripe(config);
	const webhook_url = `${app_url}${config.base_path}/webhook`;

	// Check for existing webhook with this URL
	const existing = await stripeCall(() =>
		stripe.webhookEndpoints.list({ limit: 100 }),
	);

	const match = existing.data.find(
		(wh) => wh.url === webhook_url && wh.status === 'enabled',
	);

	if (match) {
		if (config.dev) {
			// In dev mode, delete and recreate to get a fresh secret
			await stripeCall(() => stripe.webhookEndpoints.del(match.id));
		} else {
			// In production, warn that webhook_secret should be configured
			console.warn(
				'[@delightstack/stripe] Webhook endpoint exists but webhook_secret is not configured. ' +
					'Set webhook_secret in your billing config for production use.',
			);
			return '';
		}
	}

	// Create new webhook endpoint
	const webhook = await stripeCall(() =>
		stripe.webhookEndpoints.create({
			url: webhook_url,
			enabled_events: REQUIRED_EVENTS,
			description: '@delightstack/stripe auto-registered webhook',
			metadata: { delightstack: 'true' },
		}),
	);

	return webhook.secret!;
}
