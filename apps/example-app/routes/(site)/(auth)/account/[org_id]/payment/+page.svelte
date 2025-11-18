<script lang="ts" module>
	import { type Stripe, type StripeCheckout, loadStripe } from '@stripe/stripe-js';
	const STRIPE = new Promise<Stripe | undefined>(async (resolve) => {
		const library = await loadStripe(PUBLIC_STRIPE_KEY, {
			betas: ['custom_checkout_beta_5'],
		});
		resolve(library || undefined);
	});
</script>

<script lang="ts">
	import Button from '$lib/form/Button.svelte';
	import { ApiError, formatToString } from '@packages/lib';
	import Expand from '$lib/components/Expand.svelte';
	import { page } from '$app/state';
	import List from '$lib/form/List.svelte';
	import ListItem from '$lib/form/ListItem.svelte';
	import { toast } from '$lib/components';
	import { PUBLIC_STRIPE_KEY } from '$env/static/public';
	import LoadingIcon from '~icons/eos-icons/bubble-loading';
	// import LoadingIcon from '~icons/eos-icons/loading';
	import { untrack } from 'svelte';

	const { data } = $props();
	const {
		paymentMethods,
		authState,
		subscribe_to_plan,
		current_plan,
		current_subscription,
		free_trial_allowed,
		coupon,
	} = $derived(data);
	let saving = $state(false);
	let couponCode = $state(page.url.searchParams.get('coupon') || '');
	let loading = $state(false);
	let loaded = $state(false);
	let checkout = $state.raw<StripeCheckout | undefined>();
	let selectedPaymentMethod = $state('');
	let addNewPaymentMethod = $state(false);
	let isNewPaymentMethodValid = $state(false);
	let stripeEl = $state.raw<HTMLDivElement | undefined>(undefined);

	const displayTotal = $derived.by(() => {
		if (!subscribe_to_plan) return `$0`;
		let amount =
			'price_per_month' in subscribe_to_plan
				? subscribe_to_plan.price_per_month
				: subscribe_to_plan.price_per_year;
		const interval = 'price_per_month' in subscribe_to_plan ? 'month' : 'year';
		if (!coupon || !coupon.valid) {
			if (!interval) return `$${amount}`;
			return `$${amount} every ${interval}`;
		}
		let discountedAmount = amount;
		if (coupon.percent_off) {
			discountedAmount = amount - amount * (+coupon.percent_off / 100);
		}
		if (coupon.amount_off) {
			discountedAmount = amount - coupon.amount_off;
		}
		discountedAmount = Math.floor(discountedAmount * 100) / 100;
		if (coupon?.duration === 'once') {
			if (!interval) return `$${discountedAmount.toFixed(2)}`;
			return `$${discountedAmount.toFixed(2)} for the first ${interval} and $${amount} every subsequent ${interval}`;
		}
		if (coupon?.duration === 'repeating') {
			if (!interval) return `$${discountedAmount.toFixed(2)}`;
			const months = coupon.duration_in_months || 1;
			return `$${discountedAmount.toFixed(2)} each ${interval} for the first ${months} month${months > 1 ? 's' : ''} and $${amount} every subsequent ${interval}`;
		}
		if (!interval) return `$${discountedAmount.toFixed(2)}`;
		return `$${discountedAmount.toFixed(2)} every ${interval}`;
	});

	function getHexColorFromDom(cssColor: string, parentEl = document.body) {
		const el = document.createElement('div');
		el.style.display = 'none';
		el.style.color = cssColor;
		parentEl.appendChild(el);
		const normalizedColor = getComputedStyle(el).getPropertyValue('color');
		parentEl.removeChild(el);
		if (normalizedColor.startsWith('#')) return normalizedColor;
		const cvs = document.createElement('canvas');
		cvs.height = 1;
		cvs.width = 1;
		const ctx = cvs.getContext('2d');
		if (!ctx) return undefined;
		ctx.fillStyle = normalizedColor;
		ctx.fillRect(0, 0, 1, 1);
		const bytes = ctx.getImageData(0, 0, 1, 1).data;
		cvs.remove();
		return `#${[0, 1, 2].map((i) => ('0' + bytes[i].toString(16)).slice(-2)).join('')}`;
	}

	async function loadPaymentMethodForm() {
		if (!authState.orgID || loading || loaded || !stripeEl) return;
		addNewPaymentMethod = true;
		loading = true;
		const response = await fetch(`/account/${authState.orgID}/payment`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		});
		try {
			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw error;
			}
			const data = await response.json<any>();
			const stripe = await STRIPE;
			if (!stripe) throw { message: `Payment provider could not be loaded` };

			checkout = await stripe.initCheckout({
				clientSecret: data.client_secret,
				elementsOptions: {
					appearance: {
						theme: 'flat',
						labels: 'floating',
						variables: {
							colorText: getHexColorFromDom(`var(--c-text)`, stripeEl),
							colorBackground: getHexColorFromDom(`var(--c-bg)`, stripeEl),
						},
					},
				},
			});
			checkout.on('change', (session) => {
				isNewPaymentMethodValid = session.canConfirm;
				console.log('Checkout changed', $state.snapshot(session));
			});
			loaded = true;
		} catch (error) {
			toast.error(ApiError.from(error).toString());
		}
		loading = false;
	}

	$effect(() => {
		if (!checkout || !stripeEl) return;
		const cardInput = checkout.createElement('payment', {
			layout: 'tabs',
		});
		cardInput.mount(stripeEl);
		return () => cardInput?.destroy();
	});

	$effect(() => {
		untrack(() => {
			selectedPaymentMethod =
				paymentMethods.find((pm) => pm.isDefault)?.id || paymentMethods[0]?.id || '';
			if (!paymentMethods?.length) loadPaymentMethodForm();
		});
	});

	async function submit() {
		if (saving) return;
		if (!addNewPaymentMethod) {
			const paymentMethod = paymentMethods.find((pm) => pm.id === selectedPaymentMethod);
			if (!paymentMethod || !subscribe_to_plan) return;
			saving = true;
			const response = await fetch(`/account/${authState.orgID}/subscription`, {
				method: 'PUT',
				body: JSON.stringify({
					plan_id: subscribe_to_plan.id,
					payment_method_id: paymentMethod.id,
					coupon: couponCode,
				}),
			});
			if (response.ok) {
				const message = current_subscription
					? `Your account subscription successfully updated to the ${subscribe_to_plan.name} Plan`
					: `You successfully subscribed to the ${subscribe_to_plan.name} Plan`;
				window.location.href = `/${authState.orgID}/dashboard?toast=${encodeURIComponent(message)}`;
			} else {
				const error = await response.json();
				toast.error(ApiError.from(error).toString());
			}
			saving = false;
			return;
		}

		if (!checkout?.session()?.id || loading) return;
		saving = true;
		const url = new URL(document.location.href);
		if (subscribe_to_plan) {
			url.searchParams.set('subscribe_to', subscribe_to_plan.id);
			url.pathname = `/account/${authState.orgID}/checkout/${checkout.session().id}`;
		} else {
			url.searchParams.delete('subscribe_to');
		}
		const result = await checkout.confirm({ returnUrl: url.href });
		if (result.type === 'error') {
			toast.error([`Couldn't submit payment data`, result.error.message]);
		}
		saving = false;
	}

	async function deletePaymentMethod(id: string) {
		if (saving) return;
		saving = true;
		const response = await fetch(`/account/${authState.orgID}/payment/${id}`, {
			method: 'DELETE',
		});
		if (response.ok) {
			window.location.reload();
		} else {
			const error = await response.json();
			toast.error(ApiError.from(error).toString());
		}
		saving = false;
	}

	async function markPaymentMethodAsDefault(id: string) {
		if (saving) return;
		saving = true;
		const response = await fetch(`/account/${authState.orgID}/payment/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ isDefault: true }),
		});
		if (response.ok) {
			window.location.reload();
		} else {
			const error = await response.json();
			toast.error(ApiError.from(error).toString());
		}
		saving = false;
	}
</script>

<section data-sveltekit-reload class:loading>
	<h1>Payment Method</h1>
	{#if coupon}
		<div class="coupon" class:error={!coupon.valid}>
			{#if !coupon.valid}
				The entered coupon code "{coupon.code}" is invalid.
			{:else}
				The coupon code "{coupon.code}" is valid and
				{#if coupon.amount_off}
					${coupon.amount_off} will be deducted
				{:else if coupon.percent_off}
					a {coupon.percent_off}% discount will be applied
				{:else}
					the discount will be applied
				{/if}
				{#if coupon.duration === 'forever'}
					for all future invoices for this subscription.
				{:else if coupon.duration === 'once'}
					for the first invoice.
				{:else if coupon.duration === 'repeating'}
					for the first {coupon.duration_in_months || 1} month{(coupon.duration_in_months ||
						1) > 1
						? 's'
						: ''}.
				{/if}
			{/if}
		</div>
	{/if}

	{#if paymentMethods.length}
		<List style="--radius: var(--radius-4);">
			{#each paymentMethods as paymentMethod}
				<ListItem
					active={selectedPaymentMethod === paymentMethod.id && !addNewPaymentMethod}
					onclick={() => {
						selectedPaymentMethod = paymentMethod.id;
						addNewPaymentMethod = false;
					}}>
					<div class="payment-method">
						<span>{paymentMethod.name}</span>
						{#if paymentMethod.isDefault}
							<span class="default">Default</span>
						{/if}
					</div>
					{#snippet menu()}
						<div style="padding: .5rem; display: flex; flex-direction: column;">
							{#if paymentMethods.length > 1 && !paymentMethod.isDefault}
								<Button
									fullWidth
									transparent
									class="payment-method-action"
									onclick={() => markPaymentMethodAsDefault(paymentMethod.id)}>
									Mark as default payment method
								</Button>
							{/if}
							<Button
								fullWidth
								transparent
								error
								class="payment-method-action"
								onclick={() => deletePaymentMethod(paymentMethod.id)}>
								Delete payment method
							</Button>
						</div>
					{/snippet}
				</ListItem>
			{/each}
			<ListItem
				disabled={loading}
				active={addNewPaymentMethod}
				onclick={() => {
					if (loading) return;
					if (loaded) {
						addNewPaymentMethod = !addNewPaymentMethod;
					} else {
						loadPaymentMethodForm();
					}
				}}>
				{#if loading}<LoadingIcon />{/if}
				Add New Payment Method
			</ListItem>
		</List>
	{/if}

	<Expand show={addNewPaymentMethod} style="margin: -2px;">
		<div
			class="stripe-form"
			style="padding: 2px;margin-bottom: 1rem;"
			bind:this={stripeEl}>
		</div>
	</Expand>
	{#if subscribe_to_plan}
		{@const cardName = addNewPaymentMethod
			? `payment method`
			: paymentMethods.find((pm) => pm.id === selectedPaymentMethod)?.name ||
				paymentMethods[0]?.name}
		<div class="message">
			{#if current_plan && current_subscription}
				{@const isUpgrade =
					('price_per_month' in subscribe_to_plan &&
						'price_per_month' in current_subscription &&
						subscribe_to_plan.price_per_month &&
						current_subscription.price_per_month &&
						subscribe_to_plan.price_per_month > current_subscription.price_per_month) ||
					('price_per_year' in subscribe_to_plan &&
						'price_per_year' in current_subscription &&
						subscribe_to_plan.price_per_year &&
						current_subscription.price_per_year &&
						subscribe_to_plan.price_per_year > current_subscription.price_per_year) ||
					('price_per_year' in subscribe_to_plan &&
						!('price_per_year' in current_subscription))}

				<p>
					{#if isUpgrade}
						Your subscription will be {isUpgrade ? 'upgraded' : 'changed'} to the {subscribe_to_plan.name}
						Plan and you will immediately be billed a prorated amount based on the amount used
						of your current plan. Your new subscription will start immediately and be billed
						{displayTotal}.
					{:else}
						Your subscription will be scheduled to change to the {subscribe_to_plan.name} Plan
						on {formatToString(current_subscription.current_period_end, {
							type: 'date',
						})}. Your new subscription will be billed {displayTotal}. You will still be
						able to use the features of your current plan until then.
					{/if}
				</p>
			{:else if free_trial_allowed}
				<p>
					Your free trial will start immediately. After 7 days, your {cardName} will then be
					billed {displayTotal}. You can cancel anytime.
				</p>
			{:else}
				<p>
					Your {cardName} will be billed {displayTotal}. You can cancel anytime.
				</p>
			{/if}
		</div>
		<Button
			fullWidth
			disabled={loading || (addNewPaymentMethod && !isNewPaymentMethodValid)}
			onclick={submit}>
			Subscribe to {subscribe_to_plan.name} Plan
		</Button>
	{:else if addNewPaymentMethod}
		<Button fullWidth disabled={loading || !isNewPaymentMethodValid} onclick={submit}>
			Add Payment Method
		</Button>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: 300px;
	}
	.stripe-form {
		min-height: 300px;
	}
	.payment-method {
		display: flex;
		justify-content: space-between;
		width: 100%;
		.default {
			border-radius: var(--radius-2);
			border: solid 1px var(--c-outline);
			padding: 0.25rem 0.5rem;
			font-size: 0.8rem;
		}
	}
	:global(.payment-method-action > button) {
		justify-content: end !important;
	}
	.coupon {
		background-color: var(--c-bg-active);
		border-radius: var(--radius-3);
		padding: 1rem 1.5rem;
		text-wrap: pretty;
		&.error {
			background-color: var(--c-error);
			color: var(--c-error-text);
		}
	}
</style>
