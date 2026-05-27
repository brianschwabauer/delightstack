<script lang="ts">
	import { Gallery } from '@delightstack/components';
	import { featuredImages } from './_gallery-images';
</script>

<div class="full-width">
	<Gallery
		items={featuredImages}
		display="slideshow"
		aspect_ratio="16/9"
		autoplay
		duration={4000}
		meta_display_fullscreen="always" />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
