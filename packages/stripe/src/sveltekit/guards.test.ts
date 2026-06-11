import { describe, it, expect, vi } from 'vitest';
import type { ServerLoadEvent } from '@sveltejs/kit';
import { createBillingGuards } from './guards';

function makeEvent(locals: Record<string, unknown>): ServerLoadEvent {
	return {
		locals,
		url: new URL('https://app.test/dashboard?tab=1'),
	} as unknown as ServerLoadEvent;
}

/** Extracts the redirect thrown by a guard (SvelteKit redirect throws an object) */
async function getRedirect(promise: Promise<unknown>) {
	try {
		await promise;
		return null;
	} catch (error) {
		return error as { status: number; location: string };
	}
}

describe('requirePlan', () => {
	const { requirePlan } = createBillingGuards({
		plans: ['starter-monthly', 'pro-monthly'] as const,
	});

	it('redirects unauthenticated users to signin', async () => {
		const load = requirePlan('pro-monthly', () => ({ ok: true }));
		const redirect = await getRedirect(load(makeEvent({})));
		expect(redirect?.status).toBe(302);
		expect(redirect?.location).toContain('/signin');
	});

	it('passes when org_state.billing_plan_ids contains the plan', async () => {
		const loadFn = vi.fn(() => ({ ok: true }));
		const load = requirePlan('pro-monthly', loadFn);
		const result = await load(
			makeEvent({
				session: { id: 'sess_1' },
				org_state: { billing_plan_ids: ['pro-monthly'] },
			}),
		);
		expect(result).toEqual({ ok: true });
		expect(loadFn).toHaveBeenCalledOnce();
	});

	it('redirects to /pricing when the plan is not active', async () => {
		const load = requirePlan('pro-monthly', () => ({ ok: true }));
		const redirect = await getRedirect(
			load(
				makeEvent({
					session: { id: 'sess_1' },
					org_state: { billing_plan_ids: ['starter-monthly'] },
				}),
			),
		);
		expect(redirect?.status).toBe(302);
		expect(redirect?.location).toBe('/pricing');
	});

	it('redirects when billing_plan_ids has not been written yet', async () => {
		const load = requirePlan('pro-monthly', () => ({ ok: true }));
		const redirect = await getRedirect(
			load(makeEvent({ session: { id: 'sess_1' }, org_state: {} })),
		);
		expect(redirect?.status).toBe(302);
		expect(redirect?.location).toBe('/pricing');
	});
});

describe('requireSubscription', () => {
	const { requireSubscription } = createBillingGuards({
		plans: ['pro-monthly'] as const,
	});

	it('passes when the org has entitlements', async () => {
		const load = requireSubscription(() => 'ok');
		const result = await load(
			makeEvent({ session: { id: 's' }, org: { entitlements: 3 } }),
		);
		expect(result).toBe('ok');
	});

	it('redirects when the org has no entitlements', async () => {
		const load = requireSubscription(() => 'ok');
		const redirect = await getRedirect(
			load(makeEvent({ session: { id: 's' }, org: { entitlements: 0 } })),
		);
		expect(redirect?.status).toBe(302);
		expect(redirect?.location).toBe('/pricing');
	});
});
