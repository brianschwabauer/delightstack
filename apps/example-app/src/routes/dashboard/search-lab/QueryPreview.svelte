<script lang="ts">
	import { Code, Expand } from '@delightstack/components';
	import {
		encodeSearchQuery,
		type SearchQueryInput,
	} from '@delightstack/database/client';
	import { formatQuery } from './lab.svelte';

	interface Props {
		/** The DSL that ran. Rendered verbatim so the spelling is visible. */
		query: Record<string, unknown> | null;
		/** The entity the query ran against — used to build the equivalent URL. */
		entity?: string;
		/** The engine's own timing string. */
		elapsed?: string;
		/** Wall-clock round trip, including the durable object hop. */
		round_trip_ms?: number;
		/** Total matching documents. */
		count?: number;
		/** Where the query was answered. */
		mode?: 'client' | 'server';
	}

	let {
		query,
		entity = 'place',
		elapsed = undefined,
		round_trip_ms = undefined,
		count = undefined,
		mode = 'server',
	}: Props = $props();

	let show_url = $state(false);

	const json = $derived(formatQuery(query));

	// The same query as a hand-typeable REST call. `encodeSearchQuery` is the
	// exact codec the client uses, so this URL is not an approximation.
	const url = $derived.by(() => {
		if (!query) return '';
		try {
			const params = encodeSearchQuery(query as SearchQueryInput);
			const search = params.toString();
			return `GET /api/${entity}${search ? `?${search}` : ''}`;
		} catch {
			return `GET /api/${entity}`;
		}
	});
</script>

<section>
	<header>
		<h4>Query</h4>
		<dl>
			{#if count !== undefined}
				<div>
					<dt>Matches</dt>
					<dd>{count.toLocaleString()}</dd>
				</div>
			{/if}
			{#if elapsed}
				<div>
					<dt>Engine</dt>
					<dd>{elapsed}</dd>
				</div>
			{/if}
			{#if round_trip_ms !== undefined}
				<div>
					<dt>Round trip</dt>
					<dd>{round_trip_ms} ms</dd>
				</div>
			{/if}
			<div>
				<dt>Answered by</dt>
				<dd>{mode}</dd>
			</div>
		</dl>
		<button type="button" onclick={() => (show_url = !show_url)} aria-expanded={show_url}>
			{show_url ? 'Hide REST URL' : 'Show REST URL'}
		</button>
	</header>

	<Code code={json} language="json" show_line_numbers={false} max_height="18rem" wrap />

	<Expand show={show_url}>
		<div class="url">
			<Code code={url} language="plaintext" show_line_numbers={false} wrap />
		</div>
	</Expand>
</section>

<style>
	section {
		--inset: var(--space-3);
		--radius-inner: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--inset);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius-inner) + var(--inset));
	}
	@supports (corner-shape: squircle) {
		section {
			corner-shape: squircle;
			border-radius: calc((var(--radius-inner) + var(--inset)) * 2);
		}
	}

	header {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);

		h4 {
			font-size: var(--font-size-0);
			font-weight: 600;
			margin-right: auto;
		}

		button {
			font-size: var(--font-size-00);
			color: var(--color-action);
			cursor: pointer;
			position: relative;
			transition: color 250ms;

			&::before {
				content: '';
				position: absolute;
				inset: -8px;
			}
			&:hover {
				color: oklch(from var(--color-action) calc(l * 0.85) c h);
				transition: none;
			}
		}
	}

	dl {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		font-size: var(--font-size-00);

		div {
			display: flex;
			gap: var(--space-1);
		}
		dt {
			color: var(--color-text-disabled);
		}
		dd {
			font-variant-numeric: tabular-nums;
		}
	}

	.url {
		padding-top: var(--space-2);
	}
</style>
