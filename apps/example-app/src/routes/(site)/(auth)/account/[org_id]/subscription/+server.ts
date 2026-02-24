import { env } from '$env/dynamic/private';
import { syncStripeSubscription } from '$lib/server/stripe.server';
import { DelightError } from '@packages/lib';
import Stripe from 'stripe';
import { PLANS } from './plans';

export async function PUT({ locals, request }) {
	const orgID = locals.authState.orgID;
	const userID = locals.authState.id;
	const org = locals.authState.org;
	if (!locals.db) {
		throw new DelightError({
			message: `Database not available`,
			status: 500,
		});
	}
	if (!locals.authState.token || !userID) {
		throw new DelightError({
			message: `Must be signed in to update an account's subscription`,
			status: 401,
		});
	}
	if (!orgID || !org || org.id !== orgID) {
		throw new DelightError({
			message: `Must be signed in to an organization to update an account's subscription`,
			status: 401,
		});
	}
	if (org.owner_id !== userID) {
		throw new DelightError({
			message: `You must be the account owner of "${org.name}" to update the subscription.`,
			status: 403,
		});
	}
	if (!org.customer_id) {
		throw new DelightError({
			message: `No customer_id found for "${org.name}"`,
			status: 400,
		});
	}

	const body = await request.json<any>().catch(() => undefined);
	const plan_id = body?.plan_id;
	const coupon = body?.coupon;
	const payment_method_id = body?.payment_method_id;
	const plan = PLANS.find((plan) => plan.id === plan_id);
	if (!plan_id || !plan) {
		throw new DelightError({
			message: `Invalid plan_id "${plan_id}"`,
			status: 400,
		});
	}

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
	if (
		current_plan?.id === plan_id &&
		current?.subscription &&
		current?.subscription_status !== 'canceled'
	) {
		return new Response(null, { status: 204 });
	}

	const stripe = new Stripe(env.STRIPE_KEY, {
		apiVersion: '2024-10-28.acacia',
	});

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
			throw new DelightError({
				message: `Invalid coupon code "${coupon}"`,
				status: 400,
			});
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
		await stripe.subscriptions.update(current.subscription.id, {
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
			proration_behavior: updateSubscriptionImmediately
				? 'create_prorations'
				: 'always_invoice',
			billing_cycle_anchor: updateSubscriptionImmediately ? 'now' : 'unchanged',
		});
	} else {
		// Create a new subscription for the user
		await stripe.subscriptions.create({
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
		});
	}

	// Sync the updated subscription information with the database
	await syncStripeSubscription({
		authState: locals.authState,
		db: locals.db,
		auth: locals.auth,
	});
	return new Response(null, { status: 204 });
}

export async function DELETE({ locals }) {
	const orgID = locals.authState.orgID;
	const userID = locals.authState.id;
	const org = locals.authState.org;
	if (!locals.db) {
		throw new DelightError({
			message: `Database not available`,
			status: 500,
		});
	}
	if (!locals.authState.token || !userID) {
		throw new DelightError({
			message: `Must be signed in to cancel an account's subscription`,
			status: 401,
		});
	}
	if (!orgID || !org || org.id !== orgID) {
		throw new DelightError({
			message: `Must be signed in to an organization cancel an account's subscription`,
			status: 401,
		});
	}
	if (org.owner_id !== userID) {
		throw new DelightError({
			message: `You must be the account owner of "${org.name}" to cancel the subscription.`,
			status: 403,
		});
	}
	if (!org.customer_id || !org.subscription_id) {
		return new Response(null, { status: 204 });
	}

	const stripe = new Stripe(env.STRIPE_KEY, {
		apiVersion: '2024-10-28.acacia',
	});
	await stripe.subscriptions.cancel(org.subscription_id, {
		invoice_now: true,
		prorate: false,
	});
	await syncStripeSubscription({
		authState: locals.authState,
		db: locals.db,
		auth: locals.auth,
	});
	return new Response(null, { status: 204 });
}
