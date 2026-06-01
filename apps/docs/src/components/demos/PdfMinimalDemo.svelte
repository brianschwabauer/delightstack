<script lang="ts">
	import PDF from '@delightstack/components/pdf';
</script>

<div class="full-width">
	<PDF
		src="https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf"
		show_toolbar={false}
		searchable={false}
		height="400px" />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
