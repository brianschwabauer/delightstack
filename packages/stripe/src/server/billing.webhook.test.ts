import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type Stripe from 'stripe';
import { DelightError } from '@delightstack/utilities';
import { defineBillingConfig, type WebhookEventStore } from './billing.config';
import { handleWebhook, resetWebhookSecretCache } from './billing.webhook';

const { stripe_mock } = vi.hoisted(() => ({
	stripe_mock: {
		webhooks: { constructEvent: vi.fn() },
		customers: { retrieve: vi.fn() },
		subscriptions: { list: vi.fn() },
		webhookEndpoints: { list: vi.fn(), create: vi.fn(), del: vi.fn() },
	},
}));

vi.mock('./billing.stripe', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./billing.stripe')>();
	return {
		...actual,
		getStripe: () => stripe_mock as unknown as Stripe,
	};
});

let event_counter = 0;

interface FakeStripeEvent {
	id: string;
	type: string;
	data: { object: Record<string, unknown> };
}

function makeStripeEvent(
	type: string,
	object: Record<string, unknown>,
	id?: string,
): FakeStripeEvent {
	return { id: id ?? `evt_${++event_counter}`, type, data: { object } };
}

function makeRequestEvent(signature: string | null = 'valid_sig'): RequestEvent {
	const headers: Record<string, string> = {};
	if (signature) headers['stripe-signature'] = signature;
	const request = new Request('https://app.test/api/billing/webhook', {
		method: 'POST',
		body: '{}',
		headers,
	});
	return {
		request,
		url: new URL('https://app.test/api/billing/webhook'),
	} as unknown as RequestEvent;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
	return defineBillingConfig({
		secret_key: 'sk_test_webhook',
		publishable_key: 'pk_test_webhook',
		webhook_secret: 'whsec_test',
		app_url: 'https://app.test',
		...overrides,
	});
}

/** Makes constructEvent return the given event for 'valid_sig', throw otherwise */
function signEvent(stripe_event: FakeStripeEvent) {
	stripe_mock.webhooks.constructEvent.mockImplementation((_body: string, sig: string) => {
		if (sig !== 'valid_sig') throw new Error('Invalid signature');
		return stripe_event;
	});
}

beforeEach(() => {
	stripe_mock.webhooks.constructEvent.mockReset();
	stripe_mock.customers.retrieve.mockReset();
	stripe_mock.subscriptions.list.mockReset();
	stripe_mock.webhookEndpoints.list.mockReset();
	stripe_mock.webhookEndpoints.create.mockReset();
	stripe_mock.webhookEndpoints.del.mockReset();
	resetWebhookSecretCache();

	// Sensible defaults
	stripe_mock.customers.retrieve.mockResolvedValue({
		id: 'cus_1',
		metadata: { org_id: 'org_1' },
	});
	stripe_mock.subscriptions.list.mockResolvedValue({ data: [], has_more: false });
});

describe('webhook signature handling', () => {
	it('rejects requests without a stripe-signature header', async () => {
		const config = makeConfig();
		await expect(handleWebhook(makeRequestEvent(null), config, {})).rejects.toThrow(
			DelightError,
		);
	});

	it('rejects requests with an invalid signature', async () => {
		const config = makeConfig();
		signEvent(makeStripeEvent('invoice.paid', {}));
		await expect(handleWebhook(makeRequestEvent('bad_sig'), config, {})).rejects.toThrow(
			'Invalid webhook signature',
		);
	});

	it('accepts requests with a valid signature', async () => {
		const config = makeConfig();
		signEvent(makeStripeEvent('some.unhandled.event', {}));
		const response = await handleWebhook(makeRequestEvent(), config, {});
		expect(response.status).toBe(200);
	});
});

describe('webhook idempotency', () => {
	it('does not double-apply a retried event (default store)', async () => {
		const onPaymentSuccess = vi.fn();
		const config = makeConfig({ hooks: { onPaymentSuccess } });
		const stripe_event = makeStripeEvent('invoice.paid', {
			id: 'in_1',
			customer: 'cus_1',
			amount_paid: 999,
			currency: 'usd',
		});
		signEvent(stripe_event);

		const first = await handleWebhook(makeRequestEvent(), config, {});
		const second = await handleWebhook(makeRequestEvent(), config, {});

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		const second_body = (await second.json()) as { duplicate?: boolean };
		expect(second_body.duplicate).toBe(true);
		expect(onPaymentSuccess).toHaveBeenCalledTimes(1);
	});

	it('uses a custom webhook_event_store when provided', async () => {
		const seen = new Set<string>();
		const store: WebhookEventStore = {
			has: (id) => seen.has(id),
			add: (id) => {
				seen.add(id);
			},
		};
		const onPaymentSuccess = vi.fn();
		const config = makeConfig({
			hooks: { onPaymentSuccess },
			webhook_event_store: store,
		});
		const stripe_event = makeStripeEvent('invoice.paid', {
			id: 'in_2',
			customer: 'cus_1',
			amount_paid: 500,
			currency: 'usd',
		});
		signEvent(stripe_event);

		await handleWebhook(makeRequestEvent(), config, {});
		await handleWebhook(makeRequestEvent(), config, {});

		expect(onPaymentSuccess).toHaveBeenCalledTimes(1);
		expect(seen.has(stripe_event.id)).toBe(true);
	});

	it('does not mark a failed event as processed (Stripe can retry)', async () => {
		const seen = new Set<string>();
		const store: WebhookEventStore = {
			has: (id) => seen.has(id),
			add: (id) => {
				seen.add(id);
			},
		};
		const onPaymentSuccess = vi
			.fn()
			.mockRejectedValueOnce(new Error('transient failure'))
			.mockResolvedValueOnce(undefined);
		const config = makeConfig({
			hooks: { onPaymentSuccess },
			webhook_event_store: store,
		});
		const stripe_event = makeStripeEvent('invoice.paid', {
			id: 'in_3',
			customer: 'cus_1',
			amount_paid: 100,
			currency: 'usd',
		});
		signEvent(stripe_event);

		await expect(handleWebhook(makeRequestEvent(), config, {})).rejects.toThrow(
			'transient failure',
		);
		expect(seen.has(stripe_event.id)).toBe(false);

		// Retry succeeds and is then marked processed
		await handleWebhook(makeRequestEvent(), config, {});
		expect(onPaymentSuccess).toHaveBeenCalledTimes(2);
		expect(seen.has(stripe_event.id)).toBe(true);
	});
});

describe('subscription deletion', () => {
	it('fires onSubscriptionChange when a subscription is deleted with none remaining', async () => {
		const onSubscriptionChange = vi.fn();
		const config = makeConfig({ hooks: { onSubscriptionChange } });
		const stripe_event = makeStripeEvent('customer.subscription.deleted', {
			id: 'sub_gone',
			customer: 'cus_1',
		});
		signEvent(stripe_event);
		// No remaining subscriptions → syncSubscription returns null
		stripe_mock.subscriptions.list.mockResolvedValue({ data: [], has_more: false });

		const response = await handleWebhook(makeRequestEvent(), config, {});

		expect(response.status).toBe(200);
		expect(onSubscriptionChange).toHaveBeenCalledTimes(1);
		expect(onSubscriptionChange).toHaveBeenCalledWith(
			expect.objectContaining({
				customer_id: 'cus_1',
				subscription_id: 'sub_gone',
				status: 'canceled',
				plan_id: null,
				entitlements: [],
			}),
		);
	});
});

describe('amounts stay integer cents', () => {
	it('passes integer cents to onPaymentSuccess and the broadcast', async () => {
		const onPaymentSuccess = vi.fn();
		const broadcast = vi.fn();
		const config = makeConfig({ hooks: { onPaymentSuccess } });
		const stripe_event = makeStripeEvent('invoice.paid', {
			id: 'in_cents',
			customer: 'cus_1',
			amount_paid: 1234,
			currency: 'usd',
		});
		signEvent(stripe_event);

		await handleWebhook(makeRequestEvent(), config, {
			getWebsocket: () => ({ broadcast }),
		});

		expect(onPaymentSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ amount: 1234 }),
		);
		expect(broadcast).toHaveBeenCalledWith(
			expect.objectContaining({ amount: 1234, currency: 'usd' }),
		);
	});

	it('passes integer cents to onPaymentFailed', async () => {
		const onPaymentFailed = vi.fn();
		const config = makeConfig({ hooks: { onPaymentFailed } });
		const stripe_event = makeStripeEvent('invoice.payment_failed', {
			id: 'in_fail',
			customer: 'cus_1',
			amount_due: 567,
			currency: 'usd',
		});
		signEvent(stripe_event);

		await handleWebhook(makeRequestEvent(), config, {});

		expect(onPaymentFailed).toHaveBeenCalledWith(
			expect.objectContaining({ amount: 567 }),
		);
	});
});

describe('webhook secret auto-registration', () => {
	it('only registers once when two cold-start webhooks arrive simultaneously', async () => {
		const config = makeConfig({ webhook_secret: undefined, dev: true });
		signEvent(makeStripeEvent('some.unhandled.event', {}));

		// Slow registration so both requests overlap
		stripe_mock.webhookEndpoints.list.mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve({ data: [], has_more: false }), 20),
				),
		);
		stripe_mock.webhookEndpoints.create.mockResolvedValue({
			id: 'we_1',
			secret: 'whsec_auto',
		});

		const [a, b] = await Promise.all([
			handleWebhook(makeRequestEvent(), config, {}),
			handleWebhook(makeRequestEvent(), config, {}),
		]);

		expect(a.status).toBe(200);
		expect(b.status).toBe(200);
		expect(stripe_mock.webhookEndpoints.list).toHaveBeenCalledTimes(1);
		expect(stripe_mock.webhookEndpoints.create).toHaveBeenCalledTimes(1);
	});

	it('retries registration after a failure instead of caching it', async () => {
		const config = makeConfig({ webhook_secret: undefined, dev: true });
		signEvent(makeStripeEvent('some.unhandled.event', {}));

		stripe_mock.webhookEndpoints.list
			.mockRejectedValueOnce(new Error('stripe down'))
			.mockResolvedValueOnce({ data: [], has_more: false });
		stripe_mock.webhookEndpoints.create.mockResolvedValue({
			id: 'we_2',
			secret: 'whsec_auto2',
		});

		await expect(handleWebhook(makeRequestEvent(), config, {})).rejects.toThrow();
		const response = await handleWebhook(makeRequestEvent(), config, {});
		expect(response.status).toBe(200);
		expect(stripe_mock.webhookEndpoints.create).toHaveBeenCalledTimes(1);
	});

	it('throws a clear setup error in production when a webhook exists but no secret is configured', async () => {
		const config = makeConfig({ webhook_secret: undefined, dev: false });
		signEvent(makeStripeEvent('some.unhandled.event', {}));

		stripe_mock.webhookEndpoints.list.mockResolvedValue({
			data: [
				{
					id: 'we_existing',
					url: 'https://app.test/api/billing/webhook',
					status: 'enabled',
				},
			],
			has_more: false,
		});

		await expect(handleWebhook(makeRequestEvent(), config, {})).rejects.toMatchObject({
			code: 'billing/webhook_secret_missing',
		});
		expect(stripe_mock.webhookEndpoints.create).not.toHaveBeenCalled();
	});
});
