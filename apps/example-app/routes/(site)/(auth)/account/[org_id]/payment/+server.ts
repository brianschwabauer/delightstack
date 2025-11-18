import { env } from '$env/dynamic/private';
import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';
import Stripe from 'stripe';

export async function POST({ locals }) {
	const orgID = locals.authState.orgID;
	const userID = locals.authState.id;
	const org = locals.authState.org;
	if (!locals.authState.token || !userID) {
		throw apiError({
			status: 401,
			message: `Must be signed in to create a payment method session`,
		});
	}
	if (!orgID || !org || org.id !== orgID) {
		throw apiError({
			status: 401,
			message: `Must be signed in to an organization create a payment method session`,
		});
	}
	if (org.owner_id !== userID) {
		throw apiError({
			status: 403,
			message: `You must be the account owner of "${org.name}" to add the account payment methods.`,
		});
	}
	if (!locals.db) {
		throw apiError({
			status: 500,
			message: `Database not available`,
		});
	}

	const stripe = new Stripe(env.STRIPE_KEY, {
		apiVersion: '2024-10-28.acacia; custom_checkout_beta=v1' as any,
	});
	let customer_id = org.customer_id;
	if (!customer_id) {
		const customer = await stripe.customers
			.create({
				email: locals.authState.email,
				name: org.name || locals.authState.name,
				metadata: {
					owner_id: userID,
					org_id: orgID,
				},
			})
			.catch(() => undefined);
		if (customer) {
			customer_id = customer.id;
			await locals.db.updateOrg({ customer_id });
		}
	}
	if (!customer_id) {
		throw apiError({
			status: 401,
			message: `Unable to create customer in payment provider`,
		});
	}

	const checkout_session = await stripe.checkout.sessions.create({
		mode: 'setup',
		customer: customer_id,
		currency: 'USD',
		phone_number_collection: { enabled: false },
		ui_mode: 'custom',
		customer_update: { name: 'never', shipping: 'never', address: 'auto' },
		client_reference_id: orgID,
		consent_collection: {
			payment_method_reuse_agreement: { position: 'hidden' },
			terms_of_service: 'none',
		},
	});
	if (!checkout_session.client_secret) {
		throw apiError({
			status: 500,
			message: `Unable to create payment method session`,
		});
	}
	return json({ client_secret: checkout_session.client_secret }, { status: 201 });
}
