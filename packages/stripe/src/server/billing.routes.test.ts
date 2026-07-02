import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type Stripe from 'stripe';
import { DelightError } from '@delightstack/utilities';
import { defineBillingConfig } from './billing.config';
import { handleBillingRoute } from './billing.routes';

const { stripe_mock } = vi.hoisted(() => ({
	stripe_mock: {
		customers: {
			search: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			retrieve: vi.fn(),
		},
		subscriptions: {
			list: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			cancel: vi.fn(),
		},
		paymentMethods: { retrieve: vi.fn(), detach: vi.fn(), list: vi.fn() },
		prices: { list: vi.fn() },
		invoices: { list: vi.fn() },
		billingPortal: { sessions: { create: vi.fn() } },
		checkout: { sessions: { create: vi.fn() } },
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
	secret_key: 'sk_test_routes',
	publishable_key: 'pk_test_routes',
	app_url: 'https://app.test',
	entitlements: ['premium'] as const,
	plans: [
		{
			id: 'pro',
			name: 'Pro',
			lookup_key: 'pro_monthly',
			amount: 999,
			interval: 'month',
			entitlements: ['premium'],
		},
	],
});

interface EventOptions {
	method?: string;
	path?: string;
	body?: unknown;
	locals?: Record<string, unknown>;
}

function makeEvent(options: EventOptions = {}): RequestEvent {
	const url = new URL(`https://app.test/api/billing${options.path ?? '/'}`);
	const request = new Request(url, {
		method: options.method ?? 'GET',
		...(options.body !== undefined
			? {
					body: JSON.stringify(options.body),
					headers: { 'Content-Type': 'application/json' },
				}
			: {}),
	});
	return {
		request,
		url,
		locals: options.locals ?? {},
	} as unknown as RequestEvent;
}

function baseLocals(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		session: { id: 'sess_1' },
		user: { id: 'user_1', name: 'Test User', email: 'test@example.com' },
		org: { id: 'org_1', name: 'Test Org', json: null },
		org_id: 'org_1',
		org_state: { customer_id: 'cus_me' },
		setOrgState: vi.fn(),
		...overrides,
	};
}

beforeEach(() => {
	for (const group of Object.values(stripe_mock)) {
		for (const fn of Object.values(group)) {
			if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
		}
	}
	stripe_mock.billingPortal.sessions.create.mockReset();
	stripe_mock.checkout.sessions.create.mockReset();
});

describe('payment method ownership', () => {
	it("rejects detaching another customer's payment method", async () => {
		const locals = baseLocals();
		stripe_mock.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_other',
			customer: 'cus_someone_else',
		});

		const event = makeEvent({
			method: 'DELETE',
			path: '/payment-method/pm_other',
			locals,
		});

		await expect(
			handleBillingRoute(event, config, '/payment-method/pm_other', 'DELETE', {}),
		).rejects.toThrow(DelightError);
		expect(stripe_mock.paymentMethods.detach).not.toHaveBeenCalled();
	});

	it('detaches a payment method owned by the caller', async () => {
		const locals = baseLocals();
		stripe_mock.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_mine',
			customer: 'cus_me',
		});
		stripe_mock.paymentMethods.detach.mockResolvedValue({ id: 'pm_mine' });

		const event = makeEvent({
			method: 'DELETE',
			path: '/payment-method/pm_mine',
			locals,
		});
		const response = await handleBillingRoute(
			event,
			config,
			'/payment-method/pm_mine',
			'DELETE',
			{},
		);

		expect(response.status).toBe(204);
		expect(stripe_mock.paymentMethods.detach).toHaveBeenCalledWith('pm_mine');
	});

	it('verifies ownership before setting a default payment method', async () => {
		const locals = baseLocals();
		stripe_mock.paymentMethods.retrieve.mockResolvedValue({
			id: 'pm_other',
			customer: 'cus_someone_else',
		});

		const event = makeEvent({
			method: 'PATCH',
			path: '/payment-method/pm_other',
			body: {},
			locals,
		});

		await expect(
			handleBillingRoute(event, config, '/payment-method/pm_other', 'PATCH', {}),
		).rejects.toThrow(DelightError);
		expect(stripe_mock.customers.update).not.toHaveBeenCalled();
	});
});

describe('return_url validation', () => {
	it('rejects external return_url on POST /portal', async () => {
		const locals = baseLocals();
		const event = makeEvent({
			method: 'POST',
			path: '/portal',
			body: { return_url: 'https://evil.example/phish' },
			locals,
		});

		await expect(
			handleBillingRoute(event, config, '/portal', 'POST', {}),
		).rejects.toThrow(DelightError);
		expect(stripe_mock.billingPortal.sessions.create).not.toHaveBeenCalled();
	});

	it('accepts a same-origin return_url on POST /portal', async () => {
		const locals = baseLocals();
		stripe_mock.billingPortal.sessions.create.mockResolvedValue({
			url: 'https://billing.stripe.com/session',
		});

		const event = makeEvent({
			method: 'POST',
			path: '/portal',
			body: { return_url: 'https://app.test/account' },
			locals,
		});
		const response = await handleBillingRoute(event, config, '/portal', 'POST', {});

		expect(response.status).toBe(200);
		expect(stripe_mock.billingPortal.sessions.create).toHaveBeenCalledWith({
			customer: 'cus_me',
			return_url: 'https://app.test/account',
		});
	});

	it('rejects external return_url on POST /checkout', async () => {
		const locals = baseLocals();
		const event = makeEvent({
			method: 'POST',
			path: '/checkout',
			body: { plan_id: 'pro', return_url: 'https://evil.example/' },
			locals,
		});

		await expect(
			handleBillingRoute(event, config, '/checkout', 'POST', {}),
		).rejects.toThrow(DelightError);
		expect(stripe_mock.checkout.sessions.create).not.toHaveBeenCalled();
	});
});

describe('ensureCustomer org JSON merge', () => {
	it('merges customer_id into existing org json instead of overwriting', async () => {
		const updateOrg = vi.fn();
		const getOrg = vi.fn().mockResolvedValue({
			json: JSON.stringify({ theme: 'dark', feature_flags: { beta: true } }),
		});
		const locals = baseLocals({ org_state: {} }); // no cached customer

		stripe_mock.customers.search.mockResolvedValue({ data: [] });
		stripe_mock.customers.create.mockResolvedValue({ id: 'cus_new' });
		stripe_mock.checkout.sessions.create.mockResolvedValue({
			client_secret: 'cs_test',
		});

		const event = makeEvent({
			method: 'POST',
			path: '/payment-method',
			body: {},
			locals,
		});
		await handleBillingRoute(event, config, '/payment-method', 'POST', {
			getAuthServer: () => ({ updateOrg, getOrg }),
		});

		expect(getOrg).toHaveBeenCalledWith('org_1');
		expect(updateOrg).toHaveBeenCalledTimes(1);
		const [org_id, update] = updateOrg.mock.calls[0] as [string, { json: string }];
		expect(org_id).toBe('org_1');
		expect(JSON.parse(update.json)).toEqual({
			theme: 'dark',
			feature_flags: { beta: true },
			customer_id: 'cus_new',
		});
	});

	it('falls back to locals.org.json when auth.getOrg is unavailable', async () => {
		const updateOrg = vi.fn();
		const locals = baseLocals({
			org_state: {},
			org: { id: 'org_1', name: 'Test Org', json: '{"color":"red"}' },
		});

		stripe_mock.customers.search.mockResolvedValue({ data: [] });
		stripe_mock.customers.create.mockResolvedValue({ id: 'cus_new' });
		stripe_mock.checkout.sessions.create.mockResolvedValue({
			client_secret: 'cs_test',
		});

		const event = makeEvent({
			method: 'POST',
			path: '/payment-method',
			body: {},
			locals,
		});
		await handleBillingRoute(event, config, '/payment-method', 'POST', {
			getAuthServer: () => ({ updateOrg }),
		});

		const [, update] = updateOrg.mock.calls[0] as [string, { json: string }];
		expect(JSON.parse(update.json)).toEqual({
			color: 'red',
			customer_id: 'cus_new',
		});
	});
});

describe('GET /subscription (lightweight read)', () => {
	it('does not write entitlements or broadcast, but caches billing_plan_ids', async () => {
		const setOrgState = vi.fn();
		const updateOrg = vi.fn();
		const broadcast = vi.fn();
		const locals = baseLocals({ setOrgState });

		stripe_mock.subscriptions.list.mockResolvedValue({
			data: [
				{
					id: 'sub_1',
					status: 'active',
					items: {
						data: [{ price: { product: { metadata: { plan_id: 'pro' } } } }],
					},
					current_period_start: 1000,
					current_period_end: 2000,
					cancel_at: null,
					canceled_at: null,
					trial_start: null,
					trial_end: null,
				},
			],
			has_more: false,
		});

		const event = makeEvent({ method: 'GET', path: '/subscription', locals });
		const response = await handleBillingRoute(event, config, '/subscription', 'GET', {
			getAuthServer: () => ({ updateOrg }),
			getWebsocket: () => ({ broadcast }),
		});

		const data = (await response.json()) as {
			subscription: { status: string; plan_ids: string[] };
		};
		expect(data.subscription.status).toBe('active');
		expect(data.subscription.plan_ids).toEqual(['pro']);

		// Lightweight read: no auth write, no websocket broadcast
		expect(updateOrg).not.toHaveBeenCalled();
		expect(broadcast).not.toHaveBeenCalled();
		// But plan ids are cached for requirePlan()
		expect(setOrgState).toHaveBeenCalledWith({ billing_plan_ids: ['pro'] });
	});
});

describe('DELETE /subscription', () => {
	function trialingSub() {
		return {
			id: 'sub_trial',
			status: 'trialing',
			items: {
				data: [{ price: { product: { metadata: { plan_id: 'pro' } } } }],
			},
			current_period_start: 1000,
			current_period_end: 2000,
			cancel_at: null,
			canceled_at: null,
			trial_start: 1000,
			trial_end: 2000,
		};
	}

	it('cancels a trialing subscription (not just active)', async () => {
		const onSubscriptionChange = vi.fn();
		const config_with_hook = { ...config, hooks: { onSubscriptionChange } };
		const locals = baseLocals();

		stripe_mock.subscriptions.list.mockImplementation((params: { status?: string }) => {
			// The sync after cancellation sees no remaining subscriptions
			if (params?.status === 'all') {
				return Promise.resolve({ data: [], has_more: false });
			}
			return Promise.resolve({ data: [trialingSub()], has_more: false });
		});
		stripe_mock.subscriptions.cancel.mockResolvedValue({ id: 'sub_trial' });

		const event = makeEvent({
			method: 'DELETE',
			path: '/subscription',
			locals,
		});
		const response = await handleBillingRoute(
			event,
			config_with_hook,
			'/subscription',
			'DELETE',
			{},
		);

		expect(response.status).toBe(204);
		expect(stripe_mock.subscriptions.cancel).toHaveBeenCalledWith('sub_trial', {
			invoice_now: true,
			prorate: true,
		});
		// Hook fires on cancellation even though no subscription state remains
		expect(onSubscriptionChange).toHaveBeenCalledWith(
			expect.objectContaining({
				customer_id: 'cus_me',
				subscription_id: 'sub_trial',
				status: 'canceled',
				plan_id: null,
				entitlements: [],
			}),
		);
	});

	it('supports cancel_at_period_end instead of immediate cancellation', async () => {
		const locals = baseLocals();
		const active = { ...trialingSub(), id: 'sub_active', status: 'active' };

		stripe_mock.subscriptions.list.mockImplementation((params: { status?: string }) => {
			if (params?.status === 'all') {
				return Promise.resolve({
					data: [{ ...active, cancel_at: 2000 }],
					has_more: false,
				});
			}
			return Promise.resolve({ data: [active], has_more: false });
		});
		stripe_mock.subscriptions.update.mockResolvedValue({ id: 'sub_active' });

		const event = makeEvent({
			method: 'DELETE',
			path: '/subscription',
			body: { cancel_at_period_end: true },
			locals,
		});
		const response = await handleBillingRoute(
			event,
			config,
			'/subscription',
			'DELETE',
			{},
		);

		expect(response.status).toBe(204);
		expect(stripe_mock.subscriptions.update).toHaveBeenCalledWith('sub_active', {
			cancel_at_period_end: true,
		});
		expect(stripe_mock.subscriptions.cancel).not.toHaveBeenCalled();
	});
});

describe('customer search hardening', () => {
	it('rejects billing identifiers containing quotes', async () => {
		const locals = baseLocals({ org_state: {}, org_id: `org']:'x` });
		const event = makeEvent({ method: 'GET', path: '/subscription', locals });

		await expect(
			handleBillingRoute(event, config, '/subscription', 'GET', {}),
		).rejects.toThrow(DelightError);
		expect(stripe_mock.customers.search).not.toHaveBeenCalled();
	});
});

describe('one-time plans (no interval)', () => {
	const one_time_config = defineBillingConfig({
		secret_key: 'sk_test_routes',
		publishable_key: 'pk_test_routes',
		app_url: 'https://app.test',
		plans: [
			{
				id: 'pro',
				name: 'Pro',
				lookup_key: 'pro_monthly',
				amount: 999,
				interval: 'month',
			},
			{
				id: 'lifetime',
				name: 'Lifetime',
				lookup_key: 'lifetime_once',
				amount: 10000,
			},
		],
	});

	beforeEach(() => {
		stripe_mock.prices.list.mockResolvedValue({ data: [{ id: 'price_1' }] });
		stripe_mock.checkout.sessions.create.mockResolvedValue({
			client_secret: 'cs_test',
		});
	});

	it('creates a payment-mode checkout session for an interval-less plan', async () => {
		const event = makeEvent({
			method: 'POST',
			path: '/checkout',
			body: { plan_id: 'lifetime' },
			locals: baseLocals(),
		});

		await handleBillingRoute(event, one_time_config, '/checkout', 'POST', {});

		expect(stripe_mock.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'payment',
				metadata: { plan_id: 'lifetime' },
				invoice_creation: { enabled: true },
			}),
		);
	});

	it('keeps subscription mode (and plan_id metadata) for recurring plans', async () => {
		const event = makeEvent({
			method: 'POST',
			path: '/checkout',
			body: { plan_id: 'pro' },
			locals: baseLocals(),
		});

		await handleBillingRoute(event, one_time_config, '/checkout', 'POST', {});

		expect(stripe_mock.checkout.sessions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'subscription',
				metadata: { plan_id: 'pro' },
			}),
		);
		const args = stripe_mock.checkout.sessions.create.mock.calls[0]![0] as Record<
			string,
			unknown
		>;
		expect(args.invoice_creation).toBeUndefined();
	});
});
