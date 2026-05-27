import type { GalleryItem } from '@delightstack/components';

/**
 * Shared demo image set used by every Gallery / Carousel demo. Stable seeds
 * make the URLs deterministic, and the mix of aspect ratios (3:2 landscape,
 * 2:3 portrait, 1:1 square, 16:9 wide) makes masonry layouts look natural.
 *
 * `width` / `height` are required for `display="masonry"` and
 * `display="masonry-row"` — those modes use the intrinsic ratio to size each
 * tile before the image has loaded.
 */
export const demoImages: GalleryItem[] = [
	{
		id: 'photo-1',
		src: 'https://picsum.photos/seed/delight-ridge/1200/800',
		width: 1200,
		height: 800,
		name: 'Mountain ridge',
		caption: 'Morning fog rolling over the alpine ridge',
		alt: 'A pine-covered mountain ridge with low morning fog',
		type: 'image',
	},
	{
		id: 'photo-2',
		src: 'https://picsum.photos/seed/delight-portrait/800/1200',
		width: 800,
		height: 1200,
		name: 'Quiet doorway',
		caption: 'A pastel doorway in the old quarter',
		alt: 'A peach-coloured doorway between two stone walls',
		type: 'image',
	},
	{
		id: 'photo-3',
		src: 'https://picsum.photos/seed/delight-square/1000/1000',
		width: 1000,
		height: 1000,
		name: 'Garden table',
		caption: 'Sunday breakfast in the garden',
		alt: 'A round wooden table set for breakfast outdoors',
		type: 'image',
	},
	{
		id: 'photo-4',
		src: 'https://picsum.photos/seed/delight-wide/1600/900',
		width: 1600,
		height: 900,
		name: 'Coastline',
		caption: 'The long curve of the western coast at dusk',
		alt: 'A coastal cliff line photographed from above at sunset',
		type: 'image',
	},
	{
		id: 'photo-5',
		src: 'https://picsum.photos/seed/delight-forest/1200/800',
		width: 1200,
		height: 800,
		name: 'Forest path',
		caption: 'Wandering between redwoods in the late afternoon',
		alt: 'A narrow dirt path winding between tall redwood trees',
		type: 'image',
	},
	{
		id: 'photo-6',
		src: 'https://picsum.photos/seed/delight-tall/800/1200',
		width: 800,
		height: 1200,
		name: 'Library spire',
		caption: 'Looking up at the cathedral library',
		alt: 'Stone spire of a cathedral library, photographed from below',
		type: 'image',
	},
	{
		id: 'photo-7',
		src: 'https://picsum.photos/seed/delight-still/1000/1000',
		width: 1000,
		height: 1000,
		name: 'Still life',
		caption: 'Citrus and ceramics — a late afternoon study',
		alt: 'A still-life composition of oranges and ceramic plates',
		type: 'image',
	},
	{
		id: 'photo-8',
		src: 'https://picsum.photos/seed/delight-river/1600/900',
		width: 1600,
		height: 900,
		name: 'River bend',
		caption: 'The slow turn of the river beneath the bridge',
		alt: 'A river bending under an old stone bridge at twilight',
		type: 'image',
	},
];

/** A smaller subset for compact demos / slider mode. */
export const featuredImages: GalleryItem[] = demoImages.slice(0, 4);
