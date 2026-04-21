/**
 * Shared billing configuration. Imported by `hooks.server.ts` to feed
 * `createBillingHandle`, and by the billing page to render the plan
 * picker. Single source of truth — keep Stripe's lookup_keys in sync
 * with the products/prices in your Stripe dashboard.
 */

export const entitlements = ['ai', 'images'] as const;

export const plans = [
	{
		id: 'free',
		name: 'Free',
		description: 'Basic family management for small families',
		lookup_key: 'free',
		amount: 0,
		interval: 'month',
		features: [
			'Unlimited family members',
			'Create and share posts',
			'Real-time collaboration',
		],
	},
	{
		id: 'family-pro',
		name: 'Family Pro',
		description: 'AI-powered writing, image uploads, and more',
		lookup_key: 'family-pro',
		amount: 499,
		interval: 'month',
		entitlements: ['ai', 'images'],
		features: [
			'Everything in Free',
			'AI writing assistant',
			'Photo gallery & uploads',
			'Priority support',
		],
	},
] as const;

export type Plan = (typeof plans)[number];
