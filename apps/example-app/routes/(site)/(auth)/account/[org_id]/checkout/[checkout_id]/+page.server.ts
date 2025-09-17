import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import Stripe from 'stripe';
import { ApiError } from '@packages/lib';
import { PLANS } from '../../subscription/plans';
import { syncStripeSubscription } from '$lib/server/stripe.server';

export async function load({ locals, url, params }) {
	const orgID = locals.authState.orgID;
	const userID = locals.authState.id;
	const org = locals.authState.org;
	const checkout_session_id = params.checkout_id;
	if (!locals.authState.token || !userID) throw redirect(307, `/signin`);
	if (!orgID || !org || org.id !== orgID) throw redirect(307, '/account');
	if (org.owner_id !== userID) throw redirect(307, '/account');
	if (!locals.db) throw redirect(307, `/account/${orgID}/subscription`);
	if (!org.customer_id) throw redirect(307, `/account/${orgID}/subscription`);

	const stripe = new Stripe(env.STRIPE_KEY, {
		apiVersion: '2024-10-28.acacia',
	});
	const checkout_session = await stripe.checkout.sessions
		.retrieve(checkout_session_id)
		.catch(() => undefined);
	if (org.customer_id !== checkout_session?.customer) {
		throw redirect(307, `/account/${orgID}/subscription`);
	}

	let payment_method_id: string | undefined;
	if (
		checkout_session.setup_intent &&
		typeof checkout_session.setup_intent === 'string'
	) {
		const setup_intent = await stripe.setupIntents
			.retrieve(checkout_session.setup_intent)
			.catch(() => undefined);
		if (typeof setup_intent?.payment_method === 'string') {
			payment_method_id = setup_intent.payment_method;
			const payment_method = await stripe.paymentMethods
				.attach(payment_method_id, {
					customer: org.customer_id,
				})
				.catch(() => undefined);
			if (!payment_method) payment_method_id = undefined;
			if (payment_method) {
				const customer = await stripe.customers
					.retrieve(org.customer_id)
					.catch(() => undefined);
				if (
					customer &&
					!customer?.deleted &&
					!customer.invoice_settings.default_payment_method
				) {
					await stripe.customers.update(org.customer_id, {
						invoice_settings: {
							default_payment_method: payment_method_id,
						},
					});
				}
			}
		}
	}

	const plan_id =
		url.searchParams.get('subscribe_to') ||
		url.searchParams.get('plan_id') ||
		url.searchParams.get('plan');
	const coupon = url.searchParams.get('coupon');
	const plan = PLANS.find((plan) => plan.id === plan_id);
	if (!plan_id || !plan) throw redirect(307, `/account/${orgID}/payment${url.search}`);

	// Ensure the current subscription is up to date
	const current = await syncStripeSubscription({
		authState: locals.authState,
		db: locals.db,
		auth: locals.auth,
	});
	const current_plan = PLANS.find((plan) => {
		return current?.subscription?.items?.data?.some(
			(item) => item?.price?.id === plan.price_ids[0],
		);
	});
	if (current_plan?.id === plan_id) {
		throw redirect(307, `/account/${orgID}/payment${url.search}`);
	}

	// Get the promotion information from the coupon code
	let promotion: Stripe.PromotionCode | undefined;
	if (coupon) {
		const promotion_codes = await stripe.promotionCodes
			.list({
				code: coupon,
				active: true,
			})
			.catch(() => undefined);
		promotion = promotion_codes?.data?.find((promo) => {
			if (promo.max_redemptions && promo.times_redeemed >= promo.max_redemptions) {
				return false;
			}
			return true;
		});
		if (!promotion) {
			const newParams = new URLSearchParams(url.search);
			newParams.set('toast', `Invalid coupon code "${coupon}"`);
			throw redirect(307, `/account/${orgID}/payment?${newParams.toString()}`);
		}
	}

	// Update the user's current subscription with the requested plan
	if (current?.subscription && current?.subscription?.status !== 'canceled') {
		let updateSubscriptionImmediately = false;
		if (
			current_plan &&
			'price_per_month' in plan &&
			'price_per_month' in current_plan &&
			plan.price_per_month > current_plan.price_per_month
		) {
			updateSubscriptionImmediately = true;
		} else if (
			current_plan &&
			'price_per_year' in plan &&
			'price_per_year' in current_plan &&
			plan.price_per_year > current_plan.price_per_year
		) {
			updateSubscriptionImmediately = true;
		} else if (
			current_plan &&
			'price_per_year' in plan &&
			!('price_per_year' in current_plan)
		) {
			updateSubscriptionImmediately = true;
		}
		await stripe.subscriptions
			.update(current.subscription.id, {
				items: [
					...current.subscription.items.data.map((item) => ({
						id: item.id,
						deleted: true,
					})),
					...plan.price_ids.map((price_id) => ({
						price: price_id,
					})),
				],
				default_payment_method: payment_method_id,
				promotion_code: promotion?.id,
				proration_behavior: updateSubscriptionImmediately ? 'create_prorations' : 'none',
				billing_cycle_anchor: updateSubscriptionImmediately ? 'now' : 'unchanged',
			})
			.catch((err) => {
				const newParams = new URLSearchParams(url.search);
				newParams.set(
					'toast',
					[
						`An error occurred while updating your subscription`,
						ApiError.from(err).toString(),
					]
						.filter(Boolean)
						.join('. '),
				);
				throw redirect(307, `/account/${orgID}/payment?${newParams.toString()}`);
			});
	} else {
		// Create a new subscription for the user
		await stripe.subscriptions
			.create({
				customer: org.customer_id,
				items: plan.price_ids.map((price_id) => ({
					price: price_id,
				})),
				default_payment_method: payment_method_id,
				promotion_code: promotion?.id,
				trial_period_days:
					!current?.subscription_status && locals.authState.org_ids.length < 2
						? 7
						: undefined,
			})
			.catch((err) => {
				const newParams = new URLSearchParams(url.search);
				newParams.set(
					'toast',
					[
						`An error occurred while subscribing to the plan`,
						ApiError.from(err).toString(),
					]
						.filter(Boolean)
						.join('. '),
				);
				throw redirect(307, `/account/${orgID}/payment?${newParams.toString()}`);
			});
	}

	// Sync the updated subscription information with the database
	const new_state = await syncStripeSubscription({
		authState: locals.authState,
		db: locals.db,
		auth: locals.auth,
	});
	if (
		new_state?.subscription_status === 'active' ||
		new_state?.subscription_status === 'trialing'
	) {
		const message = `You successfully subscribed to the ${plan.name} Plan`;
		const newParams = new URLSearchParams(url.search);
		newParams.delete('org');
		newParams.delete('toast');
		newParams.delete('subscribe_to');
		newParams.delete('coupon');
		newParams.delete('plan');
		newParams.delete('plan_id');
		newParams.set('toast', message);
		throw redirect(307, `/${orgID}/dashboard?${newParams.toString()}`);
	} else {
		throw redirect(307, `/account/${orgID}/payment${url.search}`);
	}
}
