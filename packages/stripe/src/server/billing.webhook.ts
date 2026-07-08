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

/**
 * In-flight/cached webhook secret registration (auto-registered).
 * A single shared promise guards against two simultaneous cold-start webhooks
 * both auto-registering a webhook endpoint.
 */
let webhook_secret_promise: Promise<string> | null = null;

/** Resets the cached webhook secret (for tests) @internal */
export function resetWebhookSecretCache(): void {
	webhook_secret_promise = null;
	warned_default_store = false;
}

/** Resolve the webhook signing secret, auto-registering if needed */
async function resolveWebhookSecret(
	event: RequestEvent,
	config: ResolvedBillingConfig,
): Promise<string> {
	if (config.webhook_secret) return config.webhook_secret;

	if (!webhook_secret_promise) {
		const app_url = config.app_url ?? event.url.origin;
		webhook_secret_promise = ensureWebhookRegistered(config, app_url).catch(
			(error: unknown) => {
				// Allow a retry on the next request instead of caching the failure
				webhook_secret_promise = null;
				throw error;
			},
		);
	}

	return webhook_secret_promise;
}

// ── Webhook idempotency ────────────────────────────────────────────

/** How long processed event IDs are remembered by the default store */
const EVENT_ID_TTL_MS = 24 * 60 * 60 * 1000;
/** Max processed event IDs kept by the default store */
const EVENT_ID_CAP = 5000;

/** Default in-memory idempotency store (per-isolate, TTL + cap) */
const processed_event_ids = new Map<string, number>();

function defaultEventStoreHas(event_id: string): boolean {
	const now = Date.now();
	// Prune expired entries (Map preserves insertion order — oldest first)
	for (const [id, added_at] of processed_event_ids) {
		if (now - added_at <= EVENT_ID_TTL_MS) break;
		processed_event_ids.delete(id);
	}
	return processed_event_ids.has(event_id);
}

function defaultEventStoreAdd(event_id: string): void {
	processed_event_ids.set(event_id, Date.now());
	// Enforce the cap (evict oldest first)
	while (processed_event_ids.size > EVENT_ID_CAP) {
		const oldest = processed_event_ids.keys().next().value;
		if (oldest === undefined) break;
		processed_event_ids.delete(oldest);
	}
}

let warned_default_store = false;
/**
 * The default event store is per-isolate: on multi-isolate deployments
 * (Cloudflare Workers) a Stripe retry can land on an isolate that never saw
 * the original delivery and re-run grant-shaped hooks. Warn once so the gap
 * is visible instead of silently double-granting.
 */
function warnIfDefaultStoreIsRisky(config: ResolvedBillingConfig): void {
	if (warned_default_store || config.webhook_event_store) return;
	const hooks = config.hooks;
	const has_grant_hooks = !!(
		hooks?.onOneTimePurchase ||
		hooks?.onPaymentSuccess ||
		hooks?.onPaymentFailed
	);
	if (!has_grant_hooks) return;
	warned_default_store = true;
	console.warn(
		'[@delightstack/stripe] Webhook deduplication is using the default in-memory ' +
			'store, which is per-isolate — a Stripe retry can re-fire ' +
			'onOneTimePurchase/onPaymentSuccess/onPaymentFailed on another isolate. ' +
			'Key those side effects by ctx.event_id, and/or pass a durable ' +
			'`webhook_event_store` (see durableObjectEventStore + the StripeEventStore ' +
			'Durable Object exported from @delightstack/stripe/worker).',
	);
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

	// Idempotency — skip events that were already fully processed so Stripe
	// retries don't double-apply side effects
	const event_store = config.webhook_event_store;
	warnIfDefaultStoreIsRisky(config);
	const already_processed = event_store
		? await event_store.has(stripe_event.id)
		: defaultEventStoreHas(stripe_event.id);
	if (already_processed) {
		return new Response(JSON.stringify({ received: true, duplicate: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Dispatch event
	switch (stripe_event.type) {
		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			const subscription = stripe_event.data.object as Stripe.Subscription;
			const customer_id = extractCustomerId(subscription.customer);
			const org_id = await resolveOrgIdFromCustomer(stripe, customer_id);

			const state = await syncSubscription({
				config,
				customer_id,
				org_id,
				auth: org_id ? ctx.getAuthServer?.(event) : undefined,
				ws: org_id ? ctx.getWebsocket?.(event) : undefined,
			});

			if (config.hooks?.onSubscriptionChange) {
				if (state) {
					await config.hooks.onSubscriptionChange({
						customer_id,
						subscription_id: state.subscription_id,
						status: state.status,
						plan_id: state.plan_ids[0] ?? null,
						entitlements: state.entitlements,
						event_id: stripe_event.id,
						event,
					});
				} else if (stripe_event.type === 'customer.subscription.deleted') {
					// No remaining subscription — still fire the hook so apps can
					// react to cancellations (the most important lifecycle event)
					await config.hooks.onSubscriptionChange({
						customer_id,
						subscription_id: subscription.id,
						status: 'canceled',
						plan_id: null,
						entitlements: [],
						event_id: stripe_event.id,
						event,
					});
				}
			}
			break;
		}

		case 'invoice.paid': {
			const invoice = stripe_event.data.object as Stripe.Invoice;
			const customer_id = extractCustomerId(invoice.customer);
			const org_id = await resolveOrgIdFromCustomer(stripe, customer_id);
			const ws = org_id ? ctx.getWebsocket?.(event) : undefined;

			// Amounts stay as integer cents end-to-end — no float division
			if (ws) {
				ws.broadcast({
					event: 'billing:payment:succeeded',
					invoice_id: invoice.id,
					amount: invoice.amount_paid ?? 0,
					currency: invoice.currency,
				});
			}

			if (config.hooks?.onPaymentSuccess) {
				await config.hooks.onPaymentSuccess({
					customer_id,
					amount: invoice.amount_paid ?? 0,
					currency: invoice.currency,
					invoice_id: invoice.id,
					event_id: stripe_event.id,
				});
			}
			break;
		}

		case 'invoice.payment_failed': {
			const invoice = stripe_event.data.object as Stripe.Invoice;
			const customer_id = extractCustomerId(invoice.customer);
			const org_id = await resolveOrgIdFromCustomer(stripe, customer_id);
			const ws = org_id ? ctx.getWebsocket?.(event) : undefined;

			// Amounts stay as integer cents end-to-end — no float division
			if (ws) {
				ws.broadcast({
					event: 'billing:payment:failed',
					invoice_id: invoice.id,
					amount: invoice.amount_due ?? 0,
					currency: invoice.currency,
				});
			}

			if (config.hooks?.onPaymentFailed) {
				await config.hooks.onPaymentFailed({
					customer_id,
					amount: invoice.amount_due ?? 0,
					currency: invoice.currency,
					invoice_id: invoice.id,
					event_id: stripe_event.id,
				});
			}
			break;
		}

		case 'checkout.session.completed': {
			const session = stripe_event.data.object as Stripe.Checkout.Session;
			if (session.mode === 'subscription' && session.customer) {
				const customer_id = extractCustomerId(session.customer);
				const org_id = await resolveOrgIdFromCustomer(stripe, customer_id);

				await syncSubscription({
					config,
					customer_id,
					org_id,
					auth: org_id ? ctx.getAuthServer?.(event) : undefined,
					ws: org_id ? ctx.getWebsocket?.(event) : undefined,
				});
			} else if (session.mode === 'payment' && session.customer) {
				// One-time plan purchase — the checkout route stamped plan_id metadata.
				// The package can't know what the purchase grants; the app applies it
				// in the onOneTimePurchase hook (credit, timed pass, entitlement, ...).
				const plan_id = session.metadata?.plan_id;
				const plan = plan_id ? config.plans?.find((p) => p.id === plan_id) : undefined;
				if (plan && config.hooks?.onOneTimePurchase) {
					const customer_id = extractCustomerId(session.customer);
					const org_id = await resolveOrgIdFromCustomer(stripe, customer_id);
					await config.hooks.onOneTimePurchase({
						customer_id,
						org_id: org_id ?? null,
						plan_id: plan.id,
						amount: session.amount_total ?? plan.amount,
						currency: session.currency ?? plan.currency ?? 'usd',
						checkout_session_id: session.id,
						event_id: stripe_event.id,
						event,
					});
				}
			}
			break;
		}

		default:
			// Unhandled event type — no-op
			break;
	}

	// Mark the event as processed AFTER all side effects succeeded so a
	// failed handler is retried by Stripe (at-least-once with dedupe)
	if (event_store) await event_store.add(stripe_event.id);
	else defaultEventStoreAdd(stripe_event.id);

	return new Response(JSON.stringify({ received: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}
