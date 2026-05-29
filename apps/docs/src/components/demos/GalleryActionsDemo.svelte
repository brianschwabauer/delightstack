<script lang="ts">
	import {
		Gallery,
		pickLargestSrc,
		type GalleryItemAction,
	} from '@delightstack/components';
	import { demoImages } from './_gallery-images';

	const actions: GalleryItemAction[][] = demoImages.map((item) => {
		const src = typeof item === 'string' ? item : (item.src ?? '');
		return [
			{
				name: 'Download',
				tooltip: 'Download original',
				href: pickLargestSrc(src),
				target: '_blank' as const,
			},
		];
	});
</script>

<div class="full-width">
	<Gallery
		items={demoImages}
		display="masonry"
		size="0"
		{actions}
		action_display="hover" />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
