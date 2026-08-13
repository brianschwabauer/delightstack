<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Callout } from '@delightstack/components';
	import { address, num, text, type LabHit } from './lab.svelte';

	interface Props {
		hits: LabHit[];
		loading?: boolean;
		error?: string | null;
		/** Shown when there are no hits and nothing went wrong. */
		empty_hint?: string;
		/** Extra trailing detail per row — distance, similarity, whatever fits. */
		detail?: Snippet<[LabHit, number]>;
		/** Highlight a single row, e.g. the one the user is hovering on a map. */
		highlighted_id?: string | null;
		/** Row index offset, so page 2 keeps counting from 21. */
		offset?: number;
		onhover?: (id: string | null) => void;
	}

	let {
		hits,
		loading = false,
		error = null,
		empty_hint = 'Nothing matched. Loosen a filter or clear the term.',
		detail = undefined,
		highlighted_id = null,
		offset = 0,
		onhover = undefined,
	}: Props = $props();
</script>

{#if error}
	<Callout error title="That query did not run">{error}</Callout>
{:else if hits.length === 0 && !loading}
	<p class="empty">{empty_hint}</p>
{:else}
	<ol class:stale={loading}>
		{#each hits as hit, index (hit.id)}
			{@const place = address(hit.document)}
			{@const rating = num(hit.document, 'rating')}
			{@const price = num(hit.document, 'price')}
			<li
				class:highlighted={highlighted_id === hit.id}
				onpointerenter={() => onhover?.(hit.id)}
				onpointerleave={() => onhover?.(null)}>
				<span class="rank">{offset + index + 1}</span>
				<div class="body">
					<p class="name">
						{text(hit.document, 'name') || hit.id}
						{#if text(hit.document, 'category')}
							<span class="category">{text(hit.document, 'category')}</span>
						{/if}
					</p>
					{#if text(hit.document, 'description')}
						<p class="description">{text(hit.document, 'description')}</p>
					{/if}
					<p class="meta">
						{#if place.city}<span>{place.city}, {place.country}</span>{/if}
						{#if text(hit.document, 'organization_name')}
							<span class="derived">{text(hit.document, 'organization_name')}</span>
						{/if}
						{#if text(hit.document, 'status')}<span>
								{text(hit.document, 'status')}
							</span>{/if}
					</p>
				</div>
				<div class="numbers">
					<span class="score">{hit.score.toFixed(3)}</span>
					{#if rating !== null}<span>★ {rating.toFixed(1)}</span>{/if}
					{#if price !== null}<span>{price} spend</span>{/if}
					{#if detail}{@render detail(hit, index)}{/if}
				</div>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.empty {
		padding: var(--space-6) var(--space-4);
		text-align: center;
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
	}

	ol {
		display: flex;
		flex-direction: column;
		list-style: none;
		transition: opacity 200ms var(--ease-default);

		/* Keep results readable while the next query is in flight — dimming
		   beats swapping in a skeleton, because the rows do not move. */
		&.stale {
			opacity: 0.55;
		}
	}

	li {
		position: relative;
		display: grid;
		grid-template-columns: 2rem 1fr auto;
		gap: var(--space-3);
		align-items: start;
		padding: var(--space-3) var(--space-2);
		border-bottom: 1px solid var(--color-border);
		transition: background-color 280ms;

		&:hover,
		&.highlighted {
			background-color: oklch(from var(--color-action) l c h / 0.08);
			transition: none;
		}
		&:last-child {
			border-bottom: none;
		}
	}

	.rank {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-disabled);
		font-size: var(--font-size-00);
		padding-top: 2px;
	}

	.body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.name {
		font-weight: 550;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.category {
		font-size: var(--font-size-00);
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--color-text-disabled);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: 1px var(--space-2);
	}

	.description {
		font-size: var(--font-size-00);
		color: var(--color-text-muted);
		max-width: 68ch;
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		font-size: var(--font-size-00);
		color: var(--color-text-disabled);
	}

	.derived {
		color: var(--color-action);
	}

	.numbers {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		font-size: var(--font-size-00);
		font-variant-numeric: tabular-nums;
		color: var(--color-text-disabled);
		white-space: nowrap;
	}

	.score {
		font-weight: 600;
		color: var(--color-text);
	}
</style>
