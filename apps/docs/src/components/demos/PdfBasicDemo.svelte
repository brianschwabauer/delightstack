<script lang="ts">
	import PDF from '@delightstack/components/pdf';

	let page = $state(1);
</script>

<div class="full-width">
	<PDF
		src="https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf"
		bind:page
		searchable={false}
		height="500px" />
	<p class="hint">Currently viewing page {page}.</p>
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.hint {
		font-size: 0.78rem;
		color: var(--color-text-disabled, currentColor);
		text-align: center;
		margin: 0.75rem 0 0;
		opacity: 0.75;
	}
</style>
