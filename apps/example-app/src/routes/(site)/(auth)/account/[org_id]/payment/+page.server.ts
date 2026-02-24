import { env } from '$env/dynamic/private';
import { error, redirect } from '@sveltejs/kit';
import Stripe from 'stripe';
import { DelightError } from '@packages/lib';
import { PLANS } from '../subscription/plans';

export async function load({ locals, url }) {
	const orgID = locals.authState.orgID;
	const userID = locals.authState.id;
	const org = locals.authState.org;
	if (!locals.authState.token || !userID) {
		throw redirect(307, `/signin?redirect=${encodeURIComponent(url.pathname)}`);
	}
	if (!locals.authState.verified) {
		const params = new URLSearchParams(url.search);
		throw redirect(307, `/account/verify-email${params.size ? '?' : ''}${params}`);
	}
	if (!orgID || !org || org.id !== orgID) throw redirect(307, '/account');
	if (org.owner_id !== userID) {
		throw error(
			403,
			`You must be the account owner of "${org.name}" to manage the account payments. Please contact the account owner to update the payment methods.`,
		);
	}

	const plan_id = url.searchParams.get('subscribe_to');
	const coupon = url.searchParams.get('coupon');
	const plan = PLANS.find((plan) => plan.id === plan_id);
	if (plan_id && !plan) {
		throw redirect(307, `/account/${orgID}/subscription${url.search}`);
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
			await locals.db!.updateOrg({ customer_id });
		}
	}
	if (!customer_id) throw error(500, `Unable to create customer in payment provider`);

	// Get the promotion information from the coupon code
	let promotion: Stripe.PromotionCode | undefined;
	let couponInfo:
		| {
				code: string;
				valid: boolean;
				amount_off?: number;
				percent_off?: number;
				duration?: Stripe.Coupon.Duration;
				duration_in_months?: number;
				redeem_by?: number;
		  }
		| undefined;
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
		couponInfo = {
			code: coupon,
			valid: !!promotion?.coupon?.valid,
			amount_off: (promotion?.coupon?.amount_off || 0) / 100,
			duration: promotion?.coupon?.duration,
			duration_in_months: promotion?.coupon?.duration_in_months || undefined,
			percent_off: promotion?.coupon?.percent_off || undefined,
			redeem_by: (promotion?.coupon?.redeem_by || 0) * 1000 || undefined,
		};
	}

	const customer = await stripe.customers.retrieve(customer_id).catch((err) => {
		throw error(500, DelightError.from(err).toString());
	});
	const paymentMethods = await stripe.paymentMethods
		.list({ customer: customer_id })
		.catch((err) => {
			throw error(500, DelightError.from(err).toString());
		});
	function toBrand(text: string) {
		return text
			.split('_')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}

	let current_plan: typeof plan;
	let current_subscription:
		| {
				status: Stripe.Subscription.Status;
				current_period_end: number;
				current_period_start: number;
				trial_start: number;
				trial_end: number;
				price_per_month: number;
				price_per_year: number;
		  }
		| undefined;
	let subscribe_to_plan = plan;
	if (plan) {
		try {
			if (org.subscription_id && org.subscription_status !== 'canceled') {
				const subscription = await stripe.subscriptions.retrieve(org.subscription_id);
				current_plan = PLANS.find((plan) =>
					subscription?.items?.data?.some((v) => v.price?.id === plan.price_ids[0]),
				);
				if (subscription) {
					const price_per_month = subscription.items.data.reduce((acc, item) => {
						if (
							item?.price?.recurring?.interval_count === 1 &&
							item?.price?.recurring?.interval === 'month'
						) {
							acc += item?.price?.unit_amount || 0;
						}
						return acc;
					}, 0);
					const price_per_year = subscription.items.data.reduce((acc, item) => {
						if (
							item?.price?.recurring?.interval_count === 1 &&
							item?.price?.recurring?.interval === 'year'
						) {
							acc += item?.price?.unit_amount || 0;
						}
						return acc;
					}, 0);
					current_subscription = {
						status: subscription.status,
						current_period_end: (subscription.current_period_end || 0) * 1000,
						current_period_start: (subscription.current_period_start || 0) * 1000,
						trial_start: (subscription.trial_start || 0) * 1000,
						trial_end: (subscription.trial_end || 0) * 1000,
						price_per_month: price_per_month / 100,
						price_per_year: price_per_year / 100,
					};
				}
				if (current_plan?.id === plan.id) {
					subscribe_to_plan = undefined;
				}
			}
		} catch (err) {
			throw error(500, DelightError.from(err).toString());
		}
	}

	return {
		coupon: couponInfo,
		current_plan,
		current_subscription,
		subscribe_to_plan,
		free_trial_allowed: !current_subscription && locals.authState.org_ids.length < 2,
		paymentMethods: paymentMethods.data.map((method) => {
			return {
				id: method.id,
				name: method.card
					? `${toBrand(method.card.brand)} card ending in ${method.card.last4}`
					: `${toBrand(method.type)} Payment method`,
				isDefault:
					!customer.deleted &&
					method.id === customer?.invoice_settings?.default_payment_method,
				expires: method.card?.exp_month
					? `${method.card.exp_month}/${method.card.exp_year}`
					: undefined,
			};
		}),
	};
}
