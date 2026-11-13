import type { RequestEvent } from '@sveltejs/kit';
import type Stripe from 'stripe';
import type {
	ResolvedBillingConfig,
	AuthServerRpc,
	WebsocketRpc,
} from './billing.config.js';
import type { SubscriptionState } from '../types/index.js';
import { getStripe, stripeCall } from './billing.stripe.js';

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
	return (await runSync(ctx)).state;
}

/** A subscription the caller already knows about, for when Stripe's list lags */
export interface KnownSubscription {
	id: string;
	status: string;
}

/** The state a sync computed, and the subscriptions it computed it from */
interface SyncResult {
	state: SubscriptionState | null;
	subscriptions: Stripe.Subscription[];
}

async function runSync(ctx: SyncContext): Promise<SyncResult> {
	const subscriptions = await listAllSubscriptions(ctx.config, ctx.customer_id);
	const state = computeState(ctx.config, subscriptions);

	// Update auth entitlements (cleared unless active/trialing)
	await updateEntitlements(ctx, isStateActive(state) ? state.entitlements : []);

	// Cache active plan ids in org_state so requirePlan() guards work
	ctx.setOrgState?.({ billing_plan_ids: activePlanIds(state) });

	broadcastChange(ctx, state);
	return { state, subscriptions };
}

/**
 * Re-syncs the customer (see `syncSubscription`) and then calls the
 * `onSubscriptionChange` hook. Every package path that re-syncs a customer
 * goes through here so the hook never misses one.
 *
 * `known` is the subscription the caller just saw (the webhook's object, the
 * one a route created or canceled). It is reported only when Stripe's list
 * comes back empty, as it can for a moment after a change.
 * @internal
 */
export async function syncAndNotify(
	ctx: SyncContext,
	notify: { event: RequestEvent; event_id?: string; known?: KnownSubscription },
): Promise<SubscriptionState | null> {
	const { state, subscriptions } = await runSync(ctx);
	const hook = ctx.config.hooks?.onSubscriptionChange;
	if (!hook) return state;

	const change = describeChange(state, subscriptions, notify.known);
	if (!change) return state;

	await hook({
		customer_id: ctx.customer_id,
		...change,
		...(notify.event_id ? { event_id: notify.event_id } : {}),
		event: notify.event,
	});
	return state;
}

/** The subscription the hook reports, or null when the customer has none */
function describeChange(
	state: SubscriptionState | null,
	subscriptions: Stripe.Subscription[],
	known: KnownSubscription | undefined,
): {
	subscription_id: string;
	status: string;
	plan_id: string | null;
	entitlements: string[];
} | null {
	if (state) {
		return {
			subscription_id: state.subscription_id,
			status: state.status,
			plan_id: state.plan_ids[0] ?? null,
			entitlements: state.entitlements,
		};
	}

	// Nothing in the priority list: report the newest other subscription
	// (incomplete, unpaid, paused, ...) with its real status. It grants nothing.
	const newest = [...subscriptions].sort(
		(a, b) => (b.created ?? 0) - (a.created ?? 0),
	)[0];
	const reported = newest ? { id: newest.id, status: newest.status } : known;
	if (!reported) return null;
	return {
		subscription_id: reported.id,
		status: reported.status,
		plan_id: null,
		entitlements: [],
	};
}

/**
 * The plan bits this package owns: one per entitlement that some configured
 * plan grants, at its index in `config.entitlements`. Every other bit of the
 * org's `plan` belongs to the app.
 */
export function ownedEntitlementBits(config: ResolvedBillingConfig): number {
	const entitlements_array = config.entitlements ?? [];
	let owned = 0;
	for (const plan of config.plans ?? []) {
		for (const name of plan.entitlements ?? []) {
			const bit = entitlements_array.indexOf(name);
			if (bit !== -1) owned |= 1 << bit;
		}
	}
	return owned;
}

/**
 * Sets the org's owned plan bits to the granted entitlements, leaving every
 * other bit as it was. Skips the write when nothing would change.
 */
async function updateEntitlements(
	ctx: SyncContext,
	entitlement_names: string[],
): Promise<void> {
	if (!ctx.auth || !ctx.org_id || !ctx.config.entitlements?.length) return;

	const owned = ownedEntitlementBits(ctx.config);
	if (!owned) return;

	const entitlements_array = ctx.config.entitlements;
	let granted = 0;
	for (const name of entitlement_names) {
		const bit = entitlements_array.indexOf(name);
		if (bit !== -1) granted |= 1 << bit;
	}
	granted &= owned;

	// Without a read there is no current value to preserve (see AuthServerRpc.getOrg)
	if (!ctx.auth.getOrg) {
		await ctx.auth.updateOrg(ctx.org_id, { plan: granted });
		return;
	}

	const org = await ctx.auth.getOrg(ctx.org_id);
	const current = (org?.plan ?? 0) | 0;
	const next = (current & ~owned) | granted;
	if (next === current) return;

	await ctx.auth.updateOrg(ctx.org_id, { plan: next });
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
