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
	/**
	 * Writes updates into the org_state cookie (from `event.locals.setOrgState`).
	 * Used to cache `billing_plan_ids` so `requirePlan()` guards work without
	 * hitting Stripe. Unavailable in webhook contexts (no user cookie).
	 */
	setOrgState?: (updates: Record<string, unknown>) => void;
}

/** Max pages fetched when listing a customer's subscriptions (100 per page) */
const MAX_SUBSCRIPTION_PAGES = 10;

/** Status priority used to pick the most relevant subscription */
const STATUS_PRIORITY: Stripe.Subscription.Status[] = [
	'active',
	'trialing',
	'past_due',
	'canceled',
];

/** Lists ALL subscriptions for a customer (paginated, not capped at one page) */
async function listAllSubscriptions(
	config: ResolvedBillingConfig,
	customer_id: string,
): Promise<Stripe.Subscription[]> {
	const stripe = getStripe(config);
	const all: Stripe.Subscription[] = [];
	let starting_after: string | undefined;

	for (let page = 0; page < MAX_SUBSCRIPTION_PAGES; page++) {
		const result = await stripeCall(() =>
			stripe.subscriptions.list({
				customer: customer_id,
				status: 'all',
				limit: 100,
				...(starting_after ? { starting_after } : {}),
				expand: ['data.items.data.price.product'],
			}),
		);
		all.push(...result.data);
		if (!result.has_more || result.data.length === 0) break;
		starting_after = result.data[result.data.length - 1].id;
	}

	return all;
}

/** Computes the SubscriptionState for the most relevant subscription (or null) */
function computeState(
	config: ResolvedBillingConfig,
	subscriptions: Stripe.Subscription[],
): SubscriptionState | null {
	// Find the most relevant subscription (active > trialing > past_due > canceled)
	const sorted = subscriptions
		.filter((s) => STATUS_PRIORITY.includes(s.status))
		.sort(
			(a, b) => STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status),
		);
	const subscription = sorted[0] ?? null;
	if (!subscription) return null;

	// Extract plan IDs and entitlements from the subscription's products
	const plan_ids: string[] = [];
	const granted_entitlements: string[] = [];

	for (const item of subscription.items.data) {
		const product = item.price.product as Stripe.Product;
		const plan_id = product.metadata?.plan_id;
		if (plan_id) {
			plan_ids.push(plan_id);
			// Find the matching plan definition
			const plan_def = config.plans?.find((p) => p.id === plan_id);
			if (plan_def?.entitlements) {
				granted_entitlements.push(...plan_def.entitlements);
			}
		}
	}

	return {
		subscription_id: subscription.id,
		status: subscription.status,
		plan_ids,
		entitlements: [...new Set(granted_entitlements)],
		current_period_start: subscription.current_period_start * 1000,
		current_period_end: subscription.current_period_end * 1000,
		cancel_at: subscription.cancel_at ? subscription.cancel_at * 1000 : undefined,
		canceled_at: subscription.canceled_at ? subscription.canceled_at * 1000 : undefined,
		trial_start: subscription.trial_start ? subscription.trial_start * 1000 : undefined,
		trial_end: subscription.trial_end ? subscription.trial_end * 1000 : undefined,
	};
}

/** Whether a subscription state grants its plans/entitlements */
function isStateActive(state: SubscriptionState | null): state is SubscriptionState {
	return state?.status === 'active' || state?.status === 'trialing';
}

/**
 * Lightweight read of the current subscription state from Stripe.
 * Does NOT update auth entitlements or broadcast — use for GET endpoints.
 */
export async function fetchSubscriptionState(
	config: ResolvedBillingConfig,
	customer_id: string,
): Promise<SubscriptionState | null> {
	const subscriptions = await listAllSubscriptions(config, customer_id);
	return computeState(config, subscriptions);
}

/** The plan ids that should be cached in org_state for `requirePlan()` */
export function activePlanIds(state: SubscriptionState | null): string[] {
	return isStateActive(state) ? state.plan_ids : [];
}

/**
 * Fetches the latest subscription state from Stripe and syncs entitlements
 * to the auth package. Returns the current subscription state.
 */
export async function syncSubscription(
	ctx: SyncContext,
): Promise<SubscriptionState | null> {
	const subscriptions = await listAllSubscriptions(ctx.config, ctx.customer_id);
	const state = computeState(ctx.config, subscriptions);

	// Update auth entitlements (cleared unless active/trialing)
	await updateEntitlements(ctx, isStateActive(state) ? state.entitlements : []);

	// Cache active plan ids in org_state so requirePlan() guards work
	ctx.setOrgState?.({ billing_plan_ids: activePlanIds(state) });

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
