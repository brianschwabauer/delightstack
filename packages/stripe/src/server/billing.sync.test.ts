import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { defineBillingConfig } from './billing.config';
import { syncSubscription, fetchSubscriptionState, activePlanIds } from './billing.sync';

const { stripe_mock } = vi.hoisted(() => ({
	stripe_mock: {
		subscriptions: { list: vi.fn() },
	},
}));

vi.mock('./billing.stripe', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./billing.stripe')>();
	return {
		...actual,
		getStripe: () => stripe_mock as unknown as Stripe,
	};
});

const config = defineBillingConfig({
	secret_key: 'sk_test_sync',
	publishable_key: 'pk_test_sync',
	entitlements: ['premium', 'video-uploads'] as const,
	plans: [
		{
			id: 'pro',
			name: 'Pro',
			lookup_key: 'pro_monthly',
			amount: 999,
			interval: 'month',
			entitlements: ['premium', 'video-uploads'],
		},
	],
});

interface FakeSubscription {
	id: string;
	status: string;
	items: { data: Array<{ price: { product: { metadata: { plan_id?: string } } } }> };
	current_period_start: number;
	current_period_end: number;
	cancel_at: number | null;
	canceled_at: number | null;
	trial_start: number | null;
	trial_end: number | null;
}

function makeSub(overrides: Partial<FakeSubscription> = {}): FakeSubscription {
	return {
		id: 'sub_1',
		status: 'active',
		items: { data: [{ price: { product: { metadata: { plan_id: 'pro' } } } }] },
		current_period_start: 1000,
		current_period_end: 2000,
		cancel_at: null,
		canceled_at: null,
		trial_start: null,
		trial_end: null,
		...overrides,
	};
}

function listPage(data: FakeSubscription[], has_more = false) {
	return { data, has_more };
}

beforeEach(() => {
	stripe_mock.subscriptions.list.mockReset();
});

describe('syncSubscription state transitions', () => {
	it('active subscription → entitlements encoded + plan ids cached + broadcast', async () => {
		stripe_mock.subscriptions.list.mockResolvedValue(listPage([makeSub()]));
		const updateOrg = vi.fn();
		const broadcast = vi.fn();
		const setOrgState = vi.fn();

		const state = await syncSubscription({
			config,
			customer_id: 'cus_1',
			org_id: 'org_1',
			auth: { updateOrg },
			ws: { broadcast },
			setOrgState,
		});

		expect(state?.status).toBe('active');
		expect(state?.plan_ids).toEqual(['pro']);
		expect(state?.entitlements).toEqual(['premium', 'video-uploads']);
		// bits 0 and 1 set
		expect(updateOrg).toHaveBeenCalledWith('org_1', { plan: 0b11 });
		expect(setOrgState).toHaveBeenCalledWith({ billing_plan_ids: ['pro'] });
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'billing:subscription:changed',
				status: 'active',
				plan_ids: ['pro'],
			}),
		);
	});

	it('trialing subscription grants entitlements', async () => {
		stripe_mock.subscriptions.list.mockResolvedValue(
			listPage([makeSub({ status: 'trialing', trial_start: 1000, trial_end: 2000 })]),
		);
		const updateOrg = vi.fn();
		const setOrgState = vi.fn();

		const state = await syncSubscription({
			config,
			customer_id: 'cus_1',
			org_id: 'org_1',
			auth: { updateOrg },
			setOrgState,
		});

		expect(state?.status).toBe('trialing');
		expect(updateOrg).toHaveBeenCalledWith('org_1', { plan: 0b11 });
		expect(setOrgState).toHaveBeenCalledWith({ billing_plan_ids: ['pro'] });
	});

	it('canceled subscription → entitlements + cached plan ids cleared', async () => {
		stripe_mock.subscriptions.list.mockResolvedValue(
			listPage([makeSub({ status: 'canceled', canceled_at: 1500 })]),
		);
		const updateOrg = vi.fn();
		const setOrgState = vi.fn();

		const state = await syncSubscription({
			config,
			customer_id: 'cus_1',
			org_id: 'org_1',
			auth: { updateOrg },
			setOrgState,
		});

		expect(state?.status).toBe('canceled');
		expect(updateOrg).toHaveBeenCalledWith('org_1', { plan: 0 });
		expect(setOrgState).toHaveBeenCalledWith({ billing_plan_ids: [] });
	});

	it('no subscriptions → null state, cleared entitlements, broadcast canceled', async () => {
		stripe_mock.subscriptions.list.mockResolvedValue(listPage([]));
		const updateOrg = vi.fn();
		const broadcast = vi.fn();
		const setOrgState = vi.fn();

		const state = await syncSubscription({
			config,
			customer_id: 'cus_1',
			org_id: 'org_1',
			auth: { updateOrg },
			ws: { broadcast },
			setOrgState,
		});

		expect(state).toBeNull();
		expect(updateOrg).toHaveBeenCalledWith('org_1', { plan: 0 });
		expect(setOrgState).toHaveBeenCalledWith({ billing_plan_ids: [] });
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'canceled', subscription_id: null }),
		);
	});

	it('prefers active over canceled subscriptions', async () => {
		stripe_mock.subscriptions.list.mockResolvedValue(
			listPage([
				makeSub({ id: 'sub_old', status: 'canceled' }),
				makeSub({ id: 'sub_new', status: 'active' }),
			]),
		);

		const state = await syncSubscription({ config, customer_id: 'cus_1' });
		expect(state?.subscription_id).toBe('sub_new');
		expect(state?.status).toBe('active');
	});
});

describe('subscription list pagination', () => {
	it('paginates past the first page (customers with many subscriptions)', async () => {
		const old_subs = Array.from({ length: 6 }, (_, i) =>
			makeSub({ id: `sub_old_${i}`, status: 'canceled' }),
		);
		const active = makeSub({ id: 'sub_active', status: 'active' });

		stripe_mock.subscriptions.list
			.mockResolvedValueOnce(listPage(old_subs, true))
			.mockResolvedValueOnce(listPage([active], false));

		const state = await fetchSubscriptionState(config, 'cus_many');

		expect(stripe_mock.subscriptions.list).toHaveBeenCalledTimes(2);
		// First page requests up to 100 per page (not 5)
		expect(stripe_mock.subscriptions.list.mock.calls[0][0]).toMatchObject({
			limit: 100,
		});
		// Second page continues after the last item of the first
		expect(stripe_mock.subscriptions.list.mock.calls[1][0]).toMatchObject({
			starting_after: 'sub_old_5',
		});
		expect(state?.subscription_id).toBe('sub_active');
	});
});

describe('fetchSubscriptionState (lightweight read)', () => {
	it('returns state without requiring auth/ws context', async () => {
		stripe_mock.subscriptions.list.mockResolvedValue(listPage([makeSub()]));
		const state = await fetchSubscriptionState(config, 'cus_1');
		expect(state?.status).toBe('active');
		expect(state?.plan_ids).toEqual(['pro']);
	});
});

describe('activePlanIds', () => {
	it('returns plan ids only for active/trialing states', () => {
		expect(activePlanIds(null)).toEqual([]);
		const base = {
			subscription_id: 'sub_1',
			plan_ids: ['pro'],
			entitlements: [],
			current_period_start: 0,
			current_period_end: 0,
		};
		expect(activePlanIds({ ...base, status: 'active' })).toEqual(['pro']);
		expect(activePlanIds({ ...base, status: 'trialing' })).toEqual(['pro']);
		expect(activePlanIds({ ...base, status: 'canceled' })).toEqual([]);
		expect(activePlanIds({ ...base, status: 'past_due' })).toEqual([]);
	});
});
