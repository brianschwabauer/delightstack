import { error, redirect } from '@sveltejs/kit';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import type { Org } from '@packages/types';

export async function load({ locals, url }) {
	const userID = locals.authState.id;
	if (!locals.authState.token || !userID) {
		const params = new URLSearchParams(url.search);
		params.set('redirect', url.pathname);
		throw redirect(307, `/signin${params.size ? '?' : ''}${params}`);
	}
	if (!locals.authState.verified) {
		const params = new URLSearchParams(url.search);
		throw redirect(307, `/account/verify-email${params.size ? '?' : ''}${params}`);
	}
	if (!locals.db) throw error(500, `Database not available`);

	const orgs = await locals.auth.listOrgs({
		where: {
			key: 'owner_id',
			is: '=',
			value: userID,
		},
	});
	const customers = orgs
		.map((org) => {
			try {
				const json: Partial<Org> = JSON.parse(org?.json || '{}');
				if (!json.customer_id) return;
				return {
					customer_id: json.customer_id!,
					org_id: org.id || json.id!,
					org_name: org.name || json.name,
				};
			} catch (error) {}
		})
		.filter((v) => !!v);
	let invoices: {
		org_id: string;
		org_name?: string;
		customer_id: string;
		created: number;
		amount_paid: number;
		amount_due: number;
		due_date?: number;
		id: string;
		name?: string;
		next_payment_attempt?: number;
		pdf?: string;
		period_start?: number;
		period_end?: number;
		status: Stripe.Invoice.Status;
		subtotal: number;
		tax?: number;
		total: number;
	}[] = [];
	if (customers.length) {
		const stripe = new Stripe(env.STRIPE_KEY, {
			apiVersion: '2024-10-28.acacia; custom_checkout_beta=v1' as any,
		});
		invoices = (
			await Promise.all(
				customers.map(async ({ customer_id, org_id, org_name }) => {
					const response = await stripe.invoices
						.list({
							customer: customer_id,
							limit: 10,
						})
						.catch(() => ({ data: [] }));
					if (!response.data.length) return { list: [] };

					return {
						list: response.data.map((invoice) => {
							let period_start = invoice.period_start || 0;
							let period_end = invoice.period_end || 0;
							invoice.lines.data?.forEach((line) => {
								period_start = Math.min(period_start, line.period?.start || 0);
								period_end = Math.max(period_end, line.period?.end || 0);
							});
							return {
								org_id,
								org_name,
								customer_id,
								created: invoice.created * 1000,
								amount_paid: invoice.amount_paid / 100,
								amount_due: invoice.amount_due / 100,
								due_date: invoice.due_date ? invoice.due_date * 1000 : undefined,
								id: invoice.id,
								name: invoice.number ? `Invoice #${invoice.number}` : undefined,
								next_payment_attempt: invoice.next_payment_attempt
									? invoice.next_payment_attempt * 1000
									: undefined,
								pdf: invoice.invoice_pdf || undefined,
								period_start: period_start ? period_start * 1000 : undefined,
								period_end: period_end ? period_end * 1000 : undefined,
								status:
									!invoice.status || invoice.status === 'uncollectible'
										? 'void'
										: invoice.status,
								subtotal: invoice.subtotal / 100,
								tax: invoice.tax ? invoice.tax / 100 : undefined,
								total: invoice.total / 100,
							};
						}),
					};
				}),
			)
		).flatMap((v) => v.list);
	}

	return { invoices };
}
