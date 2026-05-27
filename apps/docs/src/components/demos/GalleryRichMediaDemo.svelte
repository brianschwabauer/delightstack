<script lang="ts">
	import { Gallery } from '@delightstack/components';
	import { richMediaItems } from './_gallery-rich-media';
</script>

<div class="full-width">
	<Gallery items={richMediaItems} display="masonry-row" sizing="small" />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
