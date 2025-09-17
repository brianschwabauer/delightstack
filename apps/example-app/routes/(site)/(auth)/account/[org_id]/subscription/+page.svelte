<script lang="ts">
	import Button from '$lib/form/Button.svelte';
	import { ApiError, formatToString } from '@packages/lib';
	import Input from '$lib/form/Input.svelte';
	import { PLANS } from './plans.js';
	import Expand from '$lib/components/Expand.svelte';
	import { page } from '$app/state';
	import Modal from '$lib/components/Modal.svelte';
	import { toast } from '$lib/components';

	const { data } = $props();
	const { active_plan_id, authState, trial_end } = $derived(data);
	let showCouponCode = $state(false);
	let cancelingSubscription = $state(false);
	let promptSubscriptionCancelation = $state(false);
	let couponCode = $state(page.url.searchParams.get('coupon') || '');

	async function cancelSubscription() {
		if (cancelingSubscription) return;
		cancelingSubscription = true;
		const response = await fetch(`/account/${authState.orgID}/subscription`, {
			method: 'DELETE',
		});

		try {
			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw error;
			} else {
				window.location.reload();
			}
		} catch (error) {
			toast.error(ApiError.from(error).toString());
			throw error;
		} finally {
			cancelingSubscription = false;
		}
	}

	function getSubscribeLink(plan: string) {
		if (active_plan_id === plan) return;
		const params = new URLSearchParams(page.url.search);
		if (couponCode) params.set('coupon', couponCode);
		else params.delete('coupon');
		params.delete('org');
		params.set('subscribe_to', plan);
		return `/account/${authState.orgID}/payment?${params.toString()}`;
	}
</script>

<section data-sveltekit-reload>
	<h1>Subscription</h1>
	{#if authState.org?.subscription_status}
		{#if authState.org.subscription_status === 'canceled'}
			<div class="message error">
				Your account subscription has been canceled and your data may be deleted. You can
				re-subscribe anytime to the plans below.
			</div>
		{:else if authState.org.subscription_status === 'trialing'}
			<div class="message">
				Your free trial will end {formatToString(trial_end, { type: 'relative-date' })}
				on {formatToString(trial_end, { type: 'date' })}.
			</div>
		{:else if authState.org.subscription_status === 'paused'}
			<div class="message error">
				Your free trial has ended. Please update your payment method to resume your
				subscription. Your data will be scheduled to be deleted soon.
			</div>
		{:else if authState.org.subscription_status === 'unpaid'}
			<div class="message error">
				Your account subscription has unpaid invoices. Please update your payment method
				or cancel your subscription. If no action is taken, your data will be deleted.
			</div>
		{:else if authState.org.subscription_status === 'past_due'}
			<div class="message">
				Your account subscription has invoices that are past due. This can happen if we
				have trouble charging your payment method. You may need to update your payment
				method or contact support. If this is not resolved, your data may be deleted.
			</div>
		{:else if authState.org.subscription_status === 'incomplete' || authState.org.subscription_status === 'incomplete_expired'}
			<div class="message error">
				Your payment method couldn't be charged and your account subscription is
				incomplete. Please update your payment method or cancel your subscription.
			</div>
		{/if}
		{#if authState.org.subscription_status !== 'active' && authState.org.subscription_status !== 'canceled' && authState.org.subscription_status !== 'trialing'}
			<Button transparent fullWidth href="/account/{authState.orgID}/payment">
				Update Payment Method
			</Button>
		{/if}
	{:else if !active_plan_id}
		<div class="message">
			Select a subscription plan below. You will be billed after your free 7 day trial.
			You can cancel anytime.
		</div>
	{/if}
	<div class="plans">
		{#each PLANS as plan}
			<div class="plan">
				<h2>
					<span class="name">
						{plan.name}
					</span>
					<span class="price">
						{#if 'price_per_month' in plan}
							{@html formatToString(plan.price_per_month, {
								type: 'currency',
								html: true,
							})}
							<span class="timeframe">/month</span>
						{:else if 'price_per_year' in plan}
							{@html formatToString(plan.price_per_year, {
								type: 'currency',
								html: true,
							})}
							<span class="timeframe">/year</span>
						{/if}
					</span>
				</h2>
				<p>{plan.description}</p>
				<Button
					fullWidth
					transparent
					active={active_plan_id === plan.id}
					disabled={active_plan_id === plan.id}
					href={getSubscribeLink(plan.id)}>
					{#if active_plan_id === plan.id}
						Current Plan
					{:else}
						Select {plan.name} Plan
					{/if}
				</Button>
			</div>
		{/each}
	</div>

	{#if authState.org?.subscription_id && authState.org?.subscription_status !== 'canceled'}
		<Button
			transparent
			error
			fullWidth
			loadingSuccess={false}
			loading={cancelingSubscription}
			onclick={() => (promptSubscriptionCancelation = true)}>
			Cancel Subscription
		</Button>
		<Modal
			bind:open={promptSubscriptionCancelation}
			title="Cancel Subscription"
			width="400px">
			<p style="margin-bottom: 2rem;">
				Are you sure you want to cancel your subscription? All of your account data will
				be permanently deleted at the end of your billing cycle. You will then no longer
				be able to access your account.
			</p>
			<Button fullWidth error onclick={cancelSubscription}>
				Yes, Cancel my Subscription
			</Button>
		</Modal>
	{:else if authState.org?.subscription_status !== 'canceled'}
		<Expand show={!showCouponCode && !couponCode}>
			<Button
				fullWidth
				transparent
				dense
				size="0"
				onclick={() => (showCouponCode = true)}>
				Have a coupon code?
			</Button>
		</Expand>
		<Expand show={showCouponCode || !!couponCode}>
			<Input
				label="Coupon Code"
				bind:value={couponCode}
				hint="Coupon will be applied on checkout"></Input>
		</Expand>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 400px;
		width: 100%;
	}
	.plans {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.message {
		background-color: var(--c-bg-active);
		border-radius: var(--radius-3);
		padding: 1rem 1.5rem;
		text-wrap: pretty;
		&.error {
			background-color: var(--c-error);
			color: var(--c-error-text);
		}
	}
	.plan {
		border-radius: var(--radius);
		padding: 1rem;
		border: solid 1px var(--c-outline-disabled);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		h2 {
			display: flex;
			justify-content: space-between;
		}
		p {
			font-size: 0.9rem;
		}
		.price {
			.timeframe {
				font-size: 0.5em;
			}
			:global(.symbol) {
				font-size: 0.5em;
				vertical-align: middle;
				display: inline-block;
				margin-right: 0.1em;
			}
			:global(.decimal),
			:global(.fraction) {
				font-size: 0.65em;
				vertical-align: middle;
				margin-bottom: 0.3em;
				display: inline-block;
			}
		}
	}
</style>
