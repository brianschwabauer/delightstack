import Stripe from 'stripe';
import { DelightError } from '@delightstack/utilities';
import type { ResolvedBillingConfig } from './billing.config';
import type { PaymentMethodInfo, InvoiceInfo } from '../types';

/** Cached Stripe instance per secret key */
const stripe_instances = new Map<string, Stripe>();

/** Get or create a Stripe instance */
export function getStripe(config: ResolvedBillingConfig): Stripe {
	let instance = stripe_instances.get(config.secret_key);
	if (!instance) {
		instance = new Stripe(config.secret_key, {
			typescript: true,
			appInfo: {
				name: 'delightstack',
				version: '0.1.0',
			},
		});
		stripe_instances.set(config.secret_key, instance);
	}
	return instance;
}

/** Wraps a Stripe API call with consistent error handling */
export async function stripeCall<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error: unknown) {
		if (error instanceof Stripe.errors.StripeError) {
			throw new DelightError({
				message: error.message,
				status: error.statusCode ?? 500,
				code: `stripe/${error.type}`,
				detail: error.code ?? undefined,
			});
		}
		throw DelightError.from(error);
	}
}

/** Format a Stripe PaymentMethod into a client-safe shape */
export function formatPaymentMethod(
	method: Stripe.PaymentMethod,
	default_pm: string | Stripe.PaymentMethod | null | undefined,
): PaymentMethodInfo {
	const default_id = typeof default_pm === 'string' ? default_pm : default_pm?.id;
	const card = method.card;

	let display_name: string = method.type;
	if (card) {
		const brand =
			(card.brand || 'card').charAt(0).toUpperCase() + (card.brand || 'card').slice(1);
		display_name = `${brand} •••• ${card.last4}`;
	}

	return {
		id: method.id,
		type: method.type,
		brand: card?.brand ?? undefined,
		last4: card?.last4 ?? undefined,
		exp_month: card?.exp_month ?? undefined,
		exp_year: card?.exp_year ?? undefined,
		display_name,
		is_default: method.id === default_id,
	};
}

/**
 * Format a Stripe Invoice into a client-safe shape.
 * All amounts are integers in the smallest currency unit (cents) — never floats.
 */
export function formatInvoice(invoice: Stripe.Invoice): InvoiceInfo {
	let period_start: number | null = null;
	let period_end: number | null = null;

	if (invoice.lines?.data?.[0]) {
		const line = invoice.lines.data[0];
		period_start = line.period.start * 1000;
		period_end = line.period.end * 1000;
	}

	return {
		id: invoice.id,
		number: invoice.number,
		status: invoice.status,
		amount_paid: invoice.amount_paid ?? 0,
		amount_due: invoice.amount_due ?? 0,
		total: invoice.total ?? 0,
		currency: invoice.currency,
		created: invoice.created * 1000,
		due_date: invoice.due_date ? invoice.due_date * 1000 : null,
		period_start,
		period_end,
		pdf: invoice.invoice_pdf ?? null,
		hosted_invoice_url: invoice.hosted_invoice_url ?? null,
	};
}

/** Parse JSON body from a request, returning {} on failure */
export async function parseBody(request: Request): Promise<Record<string, unknown>> {
	try {
		return (await request.json()) as Record<string, unknown>;
	} catch {
		throw DelightError.badRequest('Invalid JSON body');
	}
}

/** Get the app URL from config or request origin */
export function getAppUrl(event: { url: URL }, config: ResolvedBillingConfig): string {
	return config.app_url ?? event.url.origin;
}

/**
 * Validates a client-provided return_url to prevent open-redirect/phishing.
 *
 * - `undefined`/non-string → returns `undefined` (caller falls back to a default)
 * - Relative paths are resolved against the app URL
 * - Absolute URLs must be http(s) and same-origin with the app URL, the
 *   request origin, or one of `config.allowed_return_origins`
 *
 * @throws DelightError 400 when the URL is malformed or not an allowed origin
 */
export function resolveReturnUrl(
	event: { url: URL },
	config: ResolvedBillingConfig,
	raw: unknown,
): string | undefined {
	if (typeof raw !== 'string' || !raw) return undefined;

	const app_url = getAppUrl(event, config);
	let parsed: URL;
	try {
		parsed = new URL(raw, app_url);
	} catch {
		throw DelightError.badRequest('Invalid return_url');
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw DelightError.badRequest('return_url must be an http(s) URL');
	}

	const allowed = new Set<string>([new URL(app_url).origin, event.url.origin]);
	for (const origin of config.allowed_return_origins ?? []) {
		try {
			allowed.add(new URL(origin).origin);
		} catch {
			// Ignore malformed allowlist entries
		}
	}

	if (!allowed.has(parsed.origin)) {
		throw DelightError.badRequest(
			'return_url must be same-origin or one of allowed_return_origins',
		);
	}

	return parsed.toString();
}
