<script lang="ts">
	import { Button, Callout, Stat, Table } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
	import { confetti } from '@delightstack/components';
	import { toast } from '@delightstack/components';
	import { formatToString } from '@delightstack/utilities';

	const { data } = $props();
	const { auth } = $derived(data);

	let loading_action = $state('');
	let plans: Array<{ id: string; name: string; description: string; amount: number; interval: string; entitlements: string[] }> = $state([]);
	let subscription: Record<string, unknown> | null = $state(null);
	let invoices: Array<Record<string, unknown>> = $state([]);

	// Fetch billing data on mount
	$effect(() => {
		fetchPlans();
		fetchSubscription();
		fetchInvoices();
	});

	async function fetchPlans() {
		try {
			const res = await fetch('/api/billing/plan');
			if (res.ok) plans = await res.json();
		} catch { /* ignore */ }
	}

	async function fetchSubscription() {
		try {
			const res = await fetch('/api/billing/subscription');
			if (res.ok) subscription = await res.json();
		} catch { /* ignore */ }
	}

	async function fetchInvoices() {
		try {
			const res = await fetch('/api/billing/invoice');
			if (res.ok) invoices = await res.json();
		} catch { /* ignore */ }
	}

	async function subscribe(plan_id: string) {
		loading_action = plan_id;
		try {
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plan_id }),
			});
			if (res.ok) {
				const data = await res.json();
				if (data.url) {
					window.location.href = data.url;
				} else {
					confetti();
					toast('Subscription updated!');
					fetchSubscription();
				}
			}
		} finally {
			loading_action = '';
		}
	}

	async function cancelSubscription() {
		loading_action = 'cancel';
		try {
			const res = await fetch('/api/billing/subscription', { method: 'DELETE' });
			if (res.ok) {
				toast('Subscription cancelled');
				fetchSubscription();
			}
		} finally {
			loading_action = '';
		}
	}

	function formatPrice(amount: number) {
		return formatToString(amount / 100, { type: 'currency', currency: 'USD' });
	}
</script>

<svelte:head>
	<title>Billing | Forever Family</title>
</svelte:head>

<div class="page">
	<header>
		<h1>Billing & Subscription</h1>
		<p>Manage your family's plan</p>
	</header>

	<!-- Current plan -->
	{#if subscription}
		<section class="current-plan">
			<Stat label="Current Plan" value={subscription.plan_ids?.[0] === 'family-pro' ? 'Family Pro' : 'Free'} />
			<Stat label="Status" value={subscription.status ?? 'active'} />
			{#if subscription.current_period_end}
				<Stat label="Renews" value={new Date(subscription.current_period_end).toLocaleDateString()} />
			{/if}
		</section>
	{/if}

	<!-- Plans -->
	<section class="plans">
		<h2>Available Plans</h2>
		<div class="plans-grid">
			<!-- Free Plan -->
			<div class="plan-card">
				<h3>Free</h3>
				<div class="price">
					<span class="amount">$0</span>
					<span class="interval">/month</span>
				</div>
				<p>Basic family management for small families</p>
				<ul>
					<li>Unlimited family members</li>
					<li>Create and share posts</li>
					<li>Real-time collaboration</li>
				</ul>
				{#if !subscription || subscription.plan_ids?.[0] !== 'family-pro'}
					<Badge>Current Plan</Badge>
				{:else}
					<Button onclick={() => subscribe('free')} transparent fullWidth disabled={loading_action === 'free'}>
						Downgrade
					</Button>
				{/if}
			</div>

			<!-- Pro Plan -->
			<div class="plan-card featured">
				<Badge>Recommended</Badge>
				<h3>Family Pro</h3>
				<div class="price">
					<span class="amount">$4.99</span>
					<span class="interval">/month</span>
				</div>
				<p>AI-powered writing, image uploads, and more</p>
				<ul>
					<li>Everything in Free</li>
					<li>AI writing assistant</li>
					<li>Photo gallery & uploads</li>
					<li>Priority support</li>
				</ul>
				{#if subscription?.plan_ids?.[0] === 'family-pro'}
					<div class="plan-actions">
						<Badge>Current Plan</Badge>
						<Button onclick={cancelSubscription} error transparent dense disabled={loading_action === 'cancel'}>
							Cancel
						</Button>
					</div>
				{:else}
					<Button onclick={() => subscribe('family-pro')} fullWidth disabled={loading_action === 'family-pro'}>
						{loading_action === 'family-pro' ? 'Processing...' : 'Upgrade to Pro'}
					</Button>
				{/if}
			</div>
		</div>
	</section>

	<!-- Invoice history -->
	{#if invoices.length > 0}
		<section class="invoices">
			<h2>Invoice History</h2>
			<div class="invoice-list">
				{#each invoices as invoice}
					<div class="invoice-row">
						<span>{invoice.number ?? 'Invoice'}</span>
						<span>{formatPrice(invoice.total ?? 0)}</span>
						<Badge dense>{invoice.status}</Badge>
						<small>{new Date(invoice.created).toLocaleDateString()}</small>
						{#if invoice.hosted_invoice_url}
							<Button href={invoice.hosted_invoice_url} transparent dense>View</Button>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-5);
	}
	header {
		p { color: var(--color-text-disabled); }
	}
	.current-plan {
		display: flex;
		gap: var(--size-5);
		flex-wrap: wrap;
		padding: var(--size-4);
		background: var(--color-bg-2);
		border-radius: var(--radius-3);
	}
	.plans-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: var(--size-4);
		margin-top: var(--size-3);
	}
	.plan-card {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding: var(--size-5);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		&.featured {
			border-color: var(--color-action);
			box-shadow: var(--shadow-2);
		}
		h3 { font-size: var(--font-size-3); }
		p { color: var(--color-text-disabled); font-size: var(--font-size-0); }
		ul {
			list-style: none;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: var(--size-2);
			font-size: var(--font-size-0);
			li::before {
				content: '✓ ';
				color: var(--color-success);
			}
		}
	}
	.price {
		display: flex;
		align-items: baseline;
		gap: var(--size-1);
		.amount { font-size: var(--font-size-5); font-weight: var(--font-weight-7); }
		.interval { color: var(--color-text-disabled); }
	}
	.plan-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.invoices {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
	}
	.invoice-list {
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
	}
	.invoice-row {
		display: flex;
		align-items: center;
		gap: var(--size-3);
		padding: var(--size-2) var(--size-3);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-2);
		font-size: var(--font-size-0);
		small { color: var(--color-text-disabled); }
	}
</style>
