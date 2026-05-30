<script lang="ts">
	import { Gallery } from '@delightstack/components';
	import { videoItems } from './_gallery-videos';
</script>

<div class="full-width">
	<Gallery items={videoItems} display="grid" autoplay_video />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
