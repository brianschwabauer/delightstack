import type Stripe from 'stripe';
import type {
	ResolvedBillingConfig,
	AuthServerRpc,
	WebsocketRpc,
} from './billing.config';
import type { SubscriptionState } from '../types';
import { getStripe, stripeCall } from './billing.stripe';

export interface SyncContext {
	config: ResolvedBillingConfig;
	customer_id: string;
	org_id?: string;
	user_id?: string;
	auth?: AuthServerRpc;
	ws?: WebsocketRpc;
}

/**
 * Fetches the latest subscription state from Stripe and syncs entitlements
 * to the auth package. Returns the current subscription state.
 */
export async function syncSubscription(
	ctx: SyncContext,
): Promise<SubscriptionState | null> {
	const stripe = getStripe(ctx.config);

	// Fetch subscriptions for this customer
	const subscriptions = await stripeCall(() =>
		stripe.subscriptions.list({
			customer: ctx.customer_id,
			status: 'all',
			limit: 5,
			expand: ['data.items.data.price.product'],
		}),
	);

	// Find the most relevant subscription (active > trialing > past_due > canceled)
	const priority: Stripe.Subscription.Status[] = [
		'active',
		'trialing',
		'past_due',
		'canceled',
	];
	const sorted = subscriptions.data
		.filter((s) => priority.includes(s.status))
		.sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status));
	const subscription = sorted[0] ?? null;

	if (!subscription) {
		// No subscription — clear entitlements
		await updateEntitlements(ctx, []);
		broadcastChange(ctx, null);
		return null;
	}

	// Extract plan IDs and entitlements from the subscription's products
	const plan_ids: string[] = [];
	const granted_entitlements: string[] = [];

	for (const item of subscription.items.data) {
		const product = item.price.product as Stripe.Product;
		const plan_id = product.metadata?.plan_id;
		if (plan_id) {
			plan_ids.push(plan_id);
			// Find the matching plan definition
			const plan_def = ctx.config.plans?.find((p) => p.id === plan_id);
			if (plan_def?.entitlements) {
				granted_entitlements.push(...plan_def.entitlements);
			}
		}
	}

	// Deduplicate entitlements
	const unique_entitlements = [...new Set(granted_entitlements)];

	// Update auth entitlements if subscription is active/trialing
	if (subscription.status === 'active' || subscription.status === 'trialing') {
		await updateEntitlements(ctx, unique_entitlements);
	} else {
		await updateEntitlements(ctx, []);
	}

	const state: SubscriptionState = {
		subscription_id: subscription.id,
		status: subscription.status,
		plan_ids,
		entitlements: unique_entitlements,
		current_period_start: subscription.current_period_start * 1000,
		current_period_end: subscription.current_period_end * 1000,
		cancel_at: subscription.cancel_at ? subscription.cancel_at * 1000 : undefined,
		canceled_at: subscription.canceled_at ? subscription.canceled_at * 1000 : undefined,
		trial_start: subscription.trial_start ? subscription.trial_start * 1000 : undefined,
		trial_end: subscription.trial_end ? subscription.trial_end * 1000 : undefined,
	};

	broadcastChange(ctx, state);
	return state;
}

/** Encode entitlement names to a bitwise integer and update the auth org */
async function updateEntitlements(
	ctx: SyncContext,
	entitlement_names: string[],
): Promise<void> {
	if (!ctx.auth || !ctx.org_id || !ctx.config.entitlements?.length) return;

	const entitlements_array = ctx.config.entitlements;
	let encoded = 0;
	for (const name of entitlement_names) {
		const bit = entitlements_array.indexOf(name);
		if (bit !== -1) encoded |= 1 << bit;
	}

	await ctx.auth.updateOrg(ctx.org_id, { plan: encoded });
}

/** Broadcast subscription change via WebSocket */
function broadcastChange(ctx: SyncContext, state: SubscriptionState | null): void {
	if (!ctx.ws) return;

	ctx.ws.broadcast({
		event: 'billing:subscription:changed',
		subscription_id: state?.subscription_id ?? null,
		status: state?.status ?? 'canceled',
		plan_ids: state?.plan_ids ?? [],
		entitlements: state?.entitlements ?? [],
	});
}
