import { redirect } from '@sveltejs/kit';
import type { ServerLoadEvent } from '@sveltejs/kit';

interface BillingGuardOptions {
	/** URL to redirect unauthenticated users to @default '/signin' */
	redirect_to?: string;
	/** URL to redirect users without a subscription to @default '/pricing' */
	subscription_redirect?: string;
}

/**
 * Creates billing-specific guard functions for SvelteKit load functions.
 *
 * @example
 * ```ts
 * const { requireSubscription, requirePlan } = createBillingGuards({
 *   plans: ['starter-monthly', 'pro-monthly'] as const,
 * });
 *
 * // In +page.server.ts:
 * export const load = requireSubscription(({ locals }) => ({ ... }));
 * export const load = requirePlan('pro-monthly', ({ locals }) => ({ ... }));
 * ```
 */
export function createBillingGuards<const P extends string>(options: {
	plans: readonly P[];
}) {
	type Plan = P;

	/**
	 * Requires any active subscription (entitlements > 0 on the org).
	 * Redirects to /pricing if no subscription.
	 */
	function requireSubscription<T>(
		loadFn: (event: ServerLoadEvent) => T | Promise<T>,
		guardOptions?: BillingGuardOptions,
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as Record<string, unknown>;
			if (!locals.session) {
				const target = guardOptions?.redirect_to ?? '/signin';
				const return_to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(302, `${target}?redirect=${return_to}`);
			}

			const org = locals.org as { entitlements?: number } | null;
			if (!org || org.entitlements == null || org.entitlements === 0) {
				throw redirect(302, guardOptions?.subscription_redirect ?? '/pricing');
			}

			return loadFn(event);
		};
	}

	/**
	 * Requires a specific plan. Checks the org_state cookie for cached billing_plan_ids.
	 * Redirects to /pricing if the plan is not active.
	 */
	function requirePlan<T>(
		plan_id: Plan,
		loadFn: (event: ServerLoadEvent) => T | Promise<T>,
		guardOptions?: BillingGuardOptions,
	): (event: ServerLoadEvent) => Promise<T> {
		return async (event) => {
			const locals = event.locals as Record<string, unknown>;
			if (!locals.session) {
				const target = guardOptions?.redirect_to ?? '/signin';
				const return_to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(302, `${target}?redirect=${return_to}`);
			}

			const org_state = locals.org_state as Record<string, unknown> | undefined;
			const plan_ids = org_state?.billing_plan_ids as string[] | undefined;
			if (!plan_ids?.includes(plan_id)) {
				throw redirect(302, guardOptions?.subscription_redirect ?? '/pricing');
			}

			return loadFn(event);
		};
	}

	return { requireSubscription, requirePlan };
}
