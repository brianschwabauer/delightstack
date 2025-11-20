import { env } from '$env/dynamic/private';
import { apiError } from '@packages/lib';
import Stripe from 'stripe';

export async function PATCH({ locals, request, params }) {
	const orgID = locals.authState.orgID;
	const userID = locals.authState.id;
	const org = locals.authState.org;
	if (!locals.authState.token || !userID) {
		throw apiError({
			status: 401,
			message: `Must be signed in to delete a payment method`,
		});
	}
	if (!orgID || !org || org.id !== orgID) {
		throw apiError({
			status: 401,
			message: `Must be signed in to an organization delete a payment method`,
		});
	}
	if (org.owner_id !== userID) {
		throw apiError({
			status: 403,
			message: `You must be the account owner of "${org.name}" to delete payment methods.`,
		});
	}
	if (!locals.db) {
		throw apiError({
			status: 500,
			message: `Database not available`,
		});
	}
	if (!org.customer_id) {
		throw apiError({
			status: 400,
			message: `No customer_id found for "${org.name}"`,
		});
	}

	const body = await request.json<any>().catch(() => undefined);
	if (body?.isDefault) {
		const stripe = new Stripe(env.STRIPE_KEY, {
			apiVersion: '2024-10-28.acacia; custom_checkout_beta=v1' as any,
		});
		await stripe.customers.update(org.customer_id, {
			invoice_settings: {
				default_payment_method: params.payment_method_id,
			},
		});
	}

	return new Response(null, { status: 204 });
}

export async function DELETE({ locals, params }) {
	const orgID = locals.authState.orgID;
	const userID = locals.authState.id;
	const org = locals.authState.org;
	if (!locals.authState.token || !userID) {
		throw apiError({
			status: 401,
			message: `Must be signed in to delete a payment method`,
		});
	}
	if (!orgID || !org || org.id !== orgID) {
		throw apiError({
			status: 401,
			message: `Must be signed in to an organization delete a payment method`,
		});
	}
	if (org.owner_id !== userID) {
		throw apiError({
			status: 403,
			message: `You must be the account owner of "${org.name}" to delete payment methods.`,
		});
	}
	if (!locals.db) {
		throw apiError({
			status: 500,
			message: `Database not available`,
		});
	}
	if (!org.customer_id) {
		throw apiError({
			status: 400,
			message: `No customer_id found for "${org.name}"`,
		});
	}

	const stripe = new Stripe(env.STRIPE_KEY, {
		apiVersion: '2024-10-28.acacia; custom_checkout_beta=v1' as any,
	});

	await stripe.paymentMethods.detach(params.payment_method_id).catch(() => {
		throw apiError({
			status: 500,
			message: `Unable to delete payment method with id "${params.payment_method_id}"`,
		});
	});
	return new Response(null, { status: 204 });
}
