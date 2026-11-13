import { describe, it, expect, vi, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { DelightError } from '@delightstack/utilities';
import {
	formatInvoice,
	getStripe,
	resolveReturnUrl,
	stripeApiOptions,
} from './billing.stripe.js';
import { defineBillingConfig } from './billing.config.js';

function makeConfig(overrides?: Partial<Parameters<typeof defineBillingConfig>[0]>) {
	return defineBillingConfig({
		secret_key: 'sk_test_123',
		publishable_key: 'pk_test_123',
		...overrides,
	});
}

describe('formatInvoice', () => {
	it('keeps amounts as integer cents (no float division)', () => {
		const invoice = {
			id: 'in_1',
			number: 'INV-001',
			status: 'paid',
			amount_paid: 499,
			amount_due: 0,
			total: 499,
			currency: 'usd',
			created: 1_700_000_000,
			due_date: null,
			lines: { data: [] },
			invoice_pdf: null,
			hosted_invoice_url: null,
		} as unknown as Stripe.Invoice;

		const formatted = formatInvoice(invoice);
		expect(formatted.amount_paid).toBe(499);
		expect(formatted.amount_due).toBe(0);
		expect(formatted.total).toBe(499);
		expect(Number.isInteger(formatted.amount_paid)).toBe(true);
		expect(Number.isInteger(formatted.total)).toBe(true);
	});

	it('handles odd cent amounts without producing floats', () => {
		const invoice = {
			id: 'in_2',
			number: null,
			status: 'open',
			amount_paid: 1,
			amount_due: 333,
			total: 334,
			currency: 'usd',
			created: 1_700_000_000,
			due_date: null,
			lines: { data: [] },
			invoice_pdf: null,
			hosted_invoice_url: null,
		} as unknown as Stripe.Invoice;

		const formatted = formatInvoice(invoice);
		expect(formatted.amount_due).toBe(333);
		expect(formatted.total).toBe(334);
	});
});

describe('resolveReturnUrl', () => {
	const event = { url: new URL('https://app.test/api/billing/portal') };

	it('returns undefined for missing/non-string values', () => {
		const config = makeConfig();
		expect(resolveReturnUrl(event, config, undefined)).toBeUndefined();
		expect(resolveReturnUrl(event, config, null)).toBeUndefined();
		expect(resolveReturnUrl(event, config, 42)).toBeUndefined();
		expect(resolveReturnUrl(event, config, '')).toBeUndefined();
	});

	it('allows same-origin absolute URLs', () => {
		const config = makeConfig();
		expect(resolveReturnUrl(event, config, 'https://app.test/account')).toBe(
			'https://app.test/account',
		);
	});

	it('resolves relative paths against the app URL', () => {
		const config = makeConfig();
		expect(resolveReturnUrl(event, config, '/billing/done')).toBe(
			'https://app.test/billing/done',
		);
	});

	it('rejects external origins (open redirect)', () => {
		const config = makeConfig();
		expect(() => resolveReturnUrl(event, config, 'https://evil.example/phish')).toThrow(
			DelightError,
		);
	});

	it('rejects non-http(s) protocols', () => {
		const config = makeConfig();
		expect(() => resolveReturnUrl(event, config, 'javascript:alert(1)')).toThrowError();
	});

	it('allows origins from allowed_return_origins', () => {
		const config = makeConfig({
			allowed_return_origins: ['https://other.test'],
		});
		expect(resolveReturnUrl(event, config, 'https://other.test/done')).toBe(
			'https://other.test/done',
		);
		expect(() => resolveReturnUrl(event, config, 'https://evil.test/done')).toThrow(
			DelightError,
		);
	});

	it('uses config.app_url as the trusted origin when set', () => {
		const config = makeConfig({ app_url: 'https://prod.test' });
		expect(resolveReturnUrl(event, config, 'https://prod.test/ok')).toBe(
			'https://prod.test/ok',
		);
	});

	it('preserves checkout session placeholders in the query string', () => {
		const config = makeConfig();
		expect(
			resolveReturnUrl(
				event,
				config,
				'https://app.test/done?session_id={CHECKOUT_SESSION_ID}',
			),
		).toBe('https://app.test/done?session_id={CHECKOUT_SESSION_ID}');
	});
});

describe('stripe_api_url (fake Stripe server)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** Stubs fetch with a fake Stripe that records every request URL */
	function fakeStripe(): string[] {
		const urls: string[] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
			urls.push(input instanceof Request ? input.url : String(input));
			return new Response(JSON.stringify({ id: 'cus_fake', object: 'customer' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		});
		return urls;
	}

	it('sends API calls through fetch to the configured base URL', async () => {
		const urls = fakeStripe();
		const config = makeConfig({
			secret_key: 'sk_test_fake_base',
			stripe_api_url: 'http://localhost:12111',
		});

		const customer = await getStripe(config).customers.retrieve('cus_fake');

		expect(customer.id).toBe('cus_fake');
		expect(urls).toEqual(['http://localhost:12111/v1/customers/cus_fake']);
	});

	it('talks to api.stripe.com over https by default, through fetch', async () => {
		const urls = fakeStripe();
		const config = makeConfig({ secret_key: 'sk_test_default_base' });

		await getStripe(config).customers.retrieve('cus_fake');

		expect(urls).toEqual(['https://api.stripe.com/v1/customers/cus_fake']);
	});

	it('keeps one client per secret key and base URL', () => {
		fakeStripe();
		const real = makeConfig({ secret_key: 'sk_test_cache' });
		const fake = makeConfig({
			secret_key: 'sk_test_cache',
			stripe_api_url: 'http://localhost:12111',
		});
		expect(getStripe(real)).toBe(getStripe(real));
		expect(getStripe(fake)).not.toBe(getStripe(real));
	});

	it('parses host, port and protocol from the URL', () => {
		expect(stripeApiOptions(undefined)).toEqual({});
		expect(stripeApiOptions('http://127.0.0.1:12111/ignored/path')).toEqual({
			host: '127.0.0.1',
			port: 12111,
			protocol: 'http',
		});
		expect(stripeApiOptions('https://stripe-mock.test')).toEqual({
			host: 'stripe-mock.test',
			port: 443,
			protocol: 'https',
		});
		expect(stripeApiOptions('http://stripe-mock.test')).toMatchObject({ port: 80 });
	});

	it('rejects a malformed or non-http(s) URL', () => {
		expect(() => stripeApiOptions('not a url')).toThrow(DelightError);
		expect(() => stripeApiOptions('ftp://stripe-mock.test')).toThrow(DelightError);
	});
});
