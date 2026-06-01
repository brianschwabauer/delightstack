<script lang="ts">
	import { Button, confetti, toast } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
	import { formatToString } from '@delightstack/utilities';
	import { invalidate } from '$app/navigation';
	import { plans } from '$lib/plans';

	const { data } = $props();
	const subscription = $derived(data.subscription as Record<string, unknown> | null);
	const invoices = $derived((data.invoices ?? []) as Array<Record<string, unknown>>);

	let loading_action = $state('');

	async function subscribe(plan_id: string) {
		loading_action = plan_id;
		try {
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plan_id }),
			});
			if (res.ok) {
				const body = await res.json();
				if (body.url) {
					window.location.href = body.url;
				} else {
					confetti();
					toast('Subscription updated!');
					await invalidate('app:billing-subscription');
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
				await invalidate('app:billing-subscription');
			}
		} finally {
			loading_action = '';
		}
	}

	function formatPrice(amount: number) {
		return formatToString(amount / 100, { type: 'currency', currency: 'USD' });
	}

	function isCurrent(plan_id: string) {
		const ids = subscription?.plan_ids as string[] | undefined;
		return ids?.[0] === plan_id;
	}
</script>

<svelte:head>
	<title>Billing | Forever Family</title>
</svelte:head>

<div class="page">
	<header>
		<h1>Billing & Subscription</h1>
		<p>Manage your family's plan and invoice history</p>
	</header>

	<!-- Current plan -->
	{#if subscription}
		<section class="current-plan">
			<div class="stat">
				<small>Current Plan</small>
				<strong>{plans.find((p) => isCurrent(p.id))?.name ?? 'Free'}</strong>
			</div>
			<div class="stat">
				<small>Status</small>
				<strong>{subscription.status ?? 'active'}</strong>
			</div>
			{#if subscription.current_period_end}
				<div class="stat">
					<small>Renews</small>
					<strong>{new Date(subscription.current_period_end as number).toLocaleDateString()}</strong>
				</div>
			{/if}
		</section>
	{/if}

	<!-- Plans -->
	<section class="plans">
		<h2>Available Plans</h2>
		<div class="plans-grid">
			{#each plans as plan (plan.id)}
				<div class="plan-card" class:featured={'entitlements' in plan}>
					{#if 'entitlements' in plan}
						<Badge>Recommended</Badge>
					{/if}
					<h3>{plan.name}</h3>
					<div class="price">
						<span class="amount">{plan.amount === 0 ? '$0' : formatPrice(plan.amount)}</span>
						<span class="interval">/{plan.interval}</span>
					</div>
					<p>{plan.description}</p>
					<ul>
						{#each plan.features as feature (feature)}
							<li>{feature}</li>
						{/each}
					</ul>
					{#if isCurrent(plan.id) || (!subscription && plan.amount === 0)}
						<div class="plan-actions">
							<Badge>Current Plan</Badge>
							{#if plan.amount > 0}
								<Button onclick={cancelSubscription} error transparent dense disabled={loading_action === 'cancel'}>
									Cancel
								</Button>
							{/if}
						</div>
					{:else}
						<Button
							onclick={() => subscribe(plan.id)}
							full_width
							transparent={plan.amount === 0}
							disabled={loading_action === plan.id}
						>
							{loading_action === plan.id
								? 'Processing...'
								: plan.amount === 0
									? 'Downgrade'
									: `Upgrade to ${plan.name}`}
						</Button>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<!-- Invoice history -->
	{#if invoices.length > 0}
		<section class="invoices">
			<h2>Invoice History</h2>
			<div class="invoice-list">
				{#each invoices as invoice (invoice.id ?? invoice.number ?? invoice.created)}
					<div class="invoice-row">
						<span>{String(invoice.number ?? 'Invoice')}</span>
						<span>{formatPrice((invoice.total as number | undefined) ?? 0)}</span>
						<Badge dense>{String(invoice.status ?? '')}</Badge>
						<small
							>{new Date(invoice.created as number).toLocaleDateString()}</small
						>
						{#if invoice.hosted_invoice_url}
							<Button href={invoice.hosted_invoice_url as string} transparent dense
								>View</Button
							>
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
		h1 {
			font-family: var(--font-serif);
			font-size: var(--font-size-4);
			letter-spacing: -0.01em;
		}
		p {
			color: var(--color-text-disabled);
			margin-top: var(--size-1);
		}
	}
	.current-plan {
		display: flex;
		gap: var(--size-5);
		flex-wrap: wrap;
		padding: var(--size-4);
		background: var(--color-bg-2);
		border-radius: var(--radius-3);
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		small {
			color: var(--color-text-disabled);
			font-size: var(--font-size-00);
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}
		strong {
			font-size: var(--font-size-2);
			text-transform: capitalize;
		}
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
