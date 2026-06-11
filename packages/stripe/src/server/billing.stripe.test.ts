import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { DelightError } from '@delightstack/utilities';
import { formatInvoice, resolveReturnUrl } from './billing.stripe';
import { defineBillingConfig } from './billing.config';

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
