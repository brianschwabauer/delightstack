import { error, redirect } from '@sveltejs/kit';
import { PLANS } from './plans';
import { DelightError } from '@packages/lib';
import { syncStripeSubscription } from '$lib/server/stripe.server';

export async function load({ locals, url }) {
	const orgID = locals.authState.orgID;
	const userID = locals.authState.id;
	const org = locals.authState.org;
	if (!locals.authState.token || !userID) throw redirect(307, '/signin');
	if (!locals.authState.verified) {
		const params = new URLSearchParams(url.search);
		throw redirect(307, `/account/verify-email${params.size ? '?' : ''}${params}`);
	}
	if (!orgID) throw redirect(307, '/account');
	if (!org) throw redirect(307, '/account');
	if (!locals.db) throw error(500, `Database not available`);
	if (org.owner_id !== userID) {
		throw error(
			403,
			`You must be the account owner of "${org.name}" to manage the account subscription. Please contact the account owner to update the subscription.`,
		);
	}
	if (!org.customer_id) return;

	const result = await syncStripeSubscription({
		authState: locals.authState,
		db: locals.db,
		auth: locals.auth,
	}).catch((err) => {
		const parsedError = DelightError.from(err);
		throw error(parsedError.status, parsedError.toString());
	});
	if (!result?.subscription) return;
	const subscription = result.subscription;
	const active_plan =
		subscription.status === 'canceled'
			? undefined
			: PLANS.find((plan) =>
					subscription.items.data?.some((v) => v.price?.id === plan.price_ids[0]),
				);
	return {
		active_plan_id: active_plan?.id,
		trial_end: subscription.trial_end ? subscription.trial_end * 1000 : null,
		current_period_start: subscription.current_period_start
			? subscription.current_period_start * 1000
			: null,
		current_period_end: subscription.current_period_end
			? subscription.current_period_end * 1000
			: null,
		cancel_at: subscription.cancel_at ? subscription.cancel_at * 1000 : null,
		canceled_at: subscription.canceled_at ? subscription.canceled_at * 1000 : null,
	};
}
