<script lang="ts">
	import { Gallery } from '@delightstack/components';
	import { featuredImages } from './_gallery-images';
</script>

<div class="full-width">
	<Gallery items={featuredImages} display="slider" aspect_ratio="16/9" />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
