<script lang="ts">
	import Button from '$lib/form/Button.svelte';
	import { formatToString } from '@packages/lib';
	import List from '$lib/form/List.svelte';
	import ListItem from '$lib/form/ListItem.svelte';

	const { data } = $props();
	const { invoices } = $derived(data);
</script>

<section data-sveltekit-reload>
	<h1>Invoices</h1>

	<List>
		{#each invoices as invoice}
			<ListItem>
				<div class="start">
					<span class="title">
						{invoice.org_name || invoice.name}
					</span>
					<span class="subtitle">
						{#if invoice.status === 'open' && invoice.due_date}
							Due {formatToString(invoice.due_date, { type: 'date' })}
						{:else if invoice.next_payment_attempt}
							Next Payment Attempt {formatToString(invoice.next_payment_attempt, {
								type: 'date',
							})}
						{:else if invoice.period_start && invoice.period_end}
							{formatToString(invoice.period_start, { type: 'date' })}
							{#if invoice.period_start !== invoice.period_end}
								- {formatToString(invoice.period_end, { type: 'date' })}
							{/if}
						{:else}
							{formatToString(invoice.created, { type: 'date' })}
						{/if}
					</span>
				</div>
				<div class="end">
					<span class="total">
						{@html formatToString(invoice.total, { type: 'currency', html: true })}
					</span>
					<span class="status">
						{invoice.status}
					</span>
				</div>
				{#snippet menu()}
					{#if invoice.pdf}
						<Button transparent href={invoice.pdf} class="account-action">
							Download PDF
						</Button>
					{/if}
				{/snippet}
			</ListItem>
		{/each}
	</List>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;

		:global(.list-item > button) {
			padding: 0;
			height: 3.5rem;
			width: 100%;
		}
	}
	.start {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: start;
		text-align: left;
		gap: 0.2rem;
		padding: 0 1rem;
		.title {
			font-size: 1.15rem;
			line-height: 1rem;
		}
		.subtitle {
			font-size: 0.95rem;
			line-height: 0.95rem;
		}
	}
	.status {
		text-transform: uppercase;
		font-size: 0.8rem;
		border: solid 1px var(--c-outline);
		border-radius: 4px;
		padding: 0.15rem 0.25rem;
	}
	.total {
		font-size: 1.25rem;
		padding: 0 0.25rem;
		:global(.symbol) {
			font-size: 0.65em;
			vertical-align: middle;
		}
		:global(.decimal),
		:global(.fraction) {
			font-size: 0.65em;
			vertical-align: middle;
		}
	}
</style>
