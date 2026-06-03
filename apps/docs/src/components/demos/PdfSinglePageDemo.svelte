<script lang="ts">
	import { Button } from '@delightstack/components';
	import PDF from '@delightstack/components/pdf';

	let page = $state(1);
	let total_pages = $state(0);
</script>

<div class="full-width">
	<div class="frame">
		<PDF
			src="https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf"
			bind:page
			single_page
			show_toolbar={false}
			searchable={false}
			fit="page"
			height="100%"
			onload={(detail) => (total_pages = detail.total_pages)} />
	</div>

	<div class="controls">
		<Button size="1" transparent disabled={page <= 1} onclick={() => page--}>
			‹ Prev page
		</Button>
		<span class="pos">
			Page {page}{total_pages ? ` / ${total_pages}` : ''}
		</span>
		<Button
			size="1"
			transparent
			disabled={!total_pages || page >= total_pages}
			onclick={() => page++}>
			Next page ›
		</Button>
	</div>
	<p class="hint">
		<code>single_page</code>
		renders only the current page, disables internal scroll, and fits the page to the container
		— designed for embedding inside Gallery/Carousel or any external page navigator.
	</p>
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.frame {
		aspect-ratio: 3 / 4;
		max-height: 70vh;
		border-radius: 0.5rem;
		overflow: hidden;
		background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
	}
	.controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-top: 0.75rem;
	}
	.pos {
		font-family: var(--font-mono, monospace);
		font-size: 0.85rem;
		color: var(--color-text-disabled, currentColor);
		min-width: 8ch;
		text-align: center;
	}
	.hint {
		font-size: 0.78rem;
		color: var(--color-text-disabled, currentColor);
		text-align: center;
		margin: 0.75rem 0 0;
		opacity: 0.75;
		line-height: 1.5;
		code {
			font-family: var(--font-mono, monospace);
			background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
			padding: 0.05rem 0.3rem;
			border-radius: 3px;
		}
	}
</style>
