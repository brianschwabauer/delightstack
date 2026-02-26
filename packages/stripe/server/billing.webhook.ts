import type { RequestEvent } from '@sveltejs/kit';
import type Stripe from 'stripe';
import type {
	ResolvedBillingConfig,
	AuthServerRpc,
	WebsocketRpc,
} from './billing.config';
import { DelightError } from '@delightstack/utilities';
import { getStripe } from './billing.stripe';
import { syncSubscription } from './billing.sync';
import { ensureWebhookRegistered } from './billing.webhook.register';

export interface WebhookContext {
	getAuthServer?: (event: RequestEvent) => AuthServerRpc | undefined;
	getWebsocket?: (event: RequestEvent) => WebsocketRpc | undefined;
}

/** Cached webhook secret (auto-registered) */
let cached_webhook_secret: string | null = null;

/** Resolve the webhook signing secret, auto-registering if needed */
async function resolveWebhookSecret(
	event: RequestEvent,
	config: ResolvedBillingConfig,
): Promise<string> {
	if (config.webhook_secret) return config.webhook_secret;

	if (!cached_webhook_secret) {
		const app_url = config.app_url ?? event.url.origin;
		cached_webhook_secret = await ensureWebhookRegistered(config, app_url);
	}

	return cached_webhook_secret;
}

/** Resolve customer_id to org_id via Stripe customer metadata */
async function resolveOrgIdFromCustomer(
	stripe: Stripe,
	customer_id: string,
): Promise<string | undefined> {
	const customer = await stripe.customers.retrieve(customer_id);
	if (customer.deleted) return undefined;
	return customer.metadata?.org_id ?? undefined;
}

/** Extract customer_id string from a Stripe object's customer field */
function extractCustomerId(
	customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string {
	if (typeof customer === 'string') return customer;
	return customer?.id ?? '';
}

export async function handleWebhook(
	event: RequestEvent,
	config: ResolvedBillingConfig,
	ctx: WebhookContext,
): Promise<Response> {
	const stripe = getStripe(config);
	const webhook_secret = await resolveWebhookSecret(event, config);

	if (!webhook_secret) {
		throw new DelightError({
			message: 'Webhook secret not configured',
			status: 500,
			code: 'billing/webhook_secret_missing',
		});
	}

	// Verify the webhook signature
	const body = await event.request.text();
	const sig = event.request.headers.get('stripe-signature');

	if (!sig) {
		throw DelightError.badRequest('Missing Stripe signature');
	}

	let stripe_event: Stripe.Event;
	try {
		stripe_event = stripe.webhooks.constructEvent(body, sig, webhook_secret);
	} catch {
		throw DelightError.badRequest('Invalid webhook signature');
	}

	// Dispatch event
	switch (stripe_event.type) {
		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			const subscription = stripe_event.data
				.object as Stripe.Subscription;
			const customer_id = extractCustomerId(subscription.customer);
			const org_id = await resolveOrgIdFromCustomer(stripe, customer_id);

			const state = await syncSubscription({
				config,
				customer_id,
				org_id,
				auth: org_id ? ctx.getAuthServer?.(event) : undefined,
				ws: org_id ? ctx.getWebsocket?.(event) : undefined,
			});

			if (config.hooks?.onSubscriptionChange && state) {
				await config.hooks.onSubscriptionChange({
					customer_id,
					subscription_id: state.subscription_id,
					status: state.status,
					plan_id: state.plan_ids[0] ?? null,
					entitlements: state.entitlements,
					event,
				});
			}
			break;
		}

		case 'invoice.paid': {
			const invoice = stripe_event.data.object as Stripe.Invoice;
			const customer_id = extractCustomerId(invoice.customer);
			const org_id = await resolveOrgIdFromCustomer(stripe, customer_id);
			const ws = org_id ? ctx.getWebsocket?.(event) : undefined;

			if (ws) {
				ws.broadcast({
					event: 'billing:payment:succeeded',
					invoice_id: invoice.id,
					amount: (invoice.amount_paid ?? 0) / 100,
					currency: invoice.currency,
				});
			}

			if (config.hooks?.onPaymentSuccess) {
				await config.hooks.onPaymentSuccess({
					customer_id,
					amount: (invoice.amount_paid ?? 0) / 100,
					currency: invoice.currency,
					invoice_id: invoice.id,
				});
			}
			break;
		}

		case 'invoice.payment_failed': {
			const invoice = stripe_event.data.object as Stripe.Invoice;
			const customer_id = extractCustomerId(invoice.customer);
			const org_id = await resolveOrgIdFromCustomer(stripe, customer_id);
			const ws = org_id ? ctx.getWebsocket?.(event) : undefined;

			if (ws) {
				ws.broadcast({
					event: 'billing:payment:failed',
					invoice_id: invoice.id,
					amount: (invoice.amount_due ?? 0) / 100,
					currency: invoice.currency,
				});
			}

			if (config.hooks?.onPaymentFailed) {
				await config.hooks.onPaymentFailed({
					customer_id,
					amount: (invoice.amount_due ?? 0) / 100,
					currency: invoice.currency,
					invoice_id: invoice.id,
				});
			}
			break;
		}

		case 'checkout.session.completed': {
			const session = stripe_event.data
				.object as Stripe.Checkout.Session;
			if (session.mode === 'subscription' && session.customer) {
				const customer_id = extractCustomerId(session.customer);
				const org_id = await resolveOrgIdFromCustomer(
					stripe,
					customer_id,
				);

				await syncSubscription({
					config,
					customer_id,
					org_id,
					auth: org_id ? ctx.getAuthServer?.(event) : undefined,
					ws: org_id ? ctx.getWebsocket?.(event) : undefined,
				});
			}
			break;
		}

		default:
			// Unhandled event type — no-op
			break;
	}

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}
