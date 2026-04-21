import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, depends }) => {
	depends('app:billing-subscription');
	// Fetch billing state in parallel. Each endpoint 4xx's gracefully when
	// the feature is disabled (e.g. Stripe not configured), so we tolerate
	// failure and fall back to empty state.
	const [subscription, invoices] = await Promise.all([
		fetch('/api/billing/subscription').then((r) => (r.ok ? r.json() : null)),
		fetch('/api/billing/invoice').then((r) => (r.ok ? r.json() : [])),
	]);
	return { subscription, invoices };
};
