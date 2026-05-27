import type { GalleryItem } from '@delightstack/components';

/**
 * A mixed-media demo set used to exercise the Gallery/Carousel built-in
 * renderers for image, pdf, panorama and video items.
 *
 * Rich items are interleaved with plain images so the Carousel never has to
 * keep two heavy renderers mounted simultaneously — the Carousel only mounts
 * rich types for the active slide and its immediate neighbours, and images
 * are cheap, so each rich item ends up isolated.
 *
 * Note: `type: 'embed'` is supported in the same way (iframe with permissive
 * `allow` flags + URL normalisation), but third-party embed payloads (YouTube,
 * Vimeo, Matterport) load multi-megabyte JS bundles per iframe, which can be
 * heavy to put on a docs page alongside other live demos. See the embed code
 * example in the docs for usage.
 *
 * All external URLs are stable public assets; swap them out for your own
 * once you're done playing.
 */
export const richMediaItems: GalleryItem[] = [
	{
		id: 'rich-image-1',
		src: 'https://picsum.photos/seed/delight-rich-1/1600/1000',
		width: 1600,
		height: 1000,
		name: 'Mountain valley',
		caption: 'A plain image — pinch to zoom, swipe to navigate',
		type: 'image',
	},
	{
		id: 'rich-image-2',
		src: 'https://picsum.photos/seed/delight-rich-2/1600/1000',
		width: 1600,
		height: 1000,
		name: 'River bend',
		caption: 'A plain image between the heavy slides.',
		type: 'image',
	},
	{
		id: 'rich-pdf',
		// Mozilla's pdf.js demo document — a small, well-known multi-page PDF.
		src: 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf',
		width: 850,
		height: 1100,
		name: 'TraceMonkey paper',
		caption: 'Swipe up/down to flip pages. Swipe past the last/first page to dismiss.',
		type: 'pdf',
	},
	{
		id: 'rich-image-3',
		src: 'https://picsum.photos/seed/delight-rich-3/1600/1000',
		width: 1600,
		height: 1000,
		name: 'Forest path',
		caption: 'A plain image between the heavy slides.',
		type: 'image',
	},
	{
		id: 'rich-panorama',
		// Pannellum demo equirectangular panorama (~2 MB).
		src: 'https://pannellum.org/images/cerro-toco-0.jpg',
		width: 1600,
		height: 800,
		name: 'Cerro Toco (360°)',
		caption: 'Drag to look around. Horizontal swipe stays inside the panorama.',
		type: 'image',
		panorama: true,
	},
	{
		id: 'rich-image-4',
		src: 'https://picsum.photos/seed/delight-rich-4/1600/1000',
		width: 1600,
		height: 1000,
		name: 'Coastline',
		caption: 'A plain image between the heavy slides.',
		type: 'image',
	},
	{
		id: 'rich-video',
		// Cloudinary's public demo bucket — ~500 KB mp4, served with permissive CORS.
		src: 'https://res.cloudinary.com/demo/video/upload/q_auto,w_640/dog.mp4',
		width: 640,
		height: 360,
		name: 'Sample video',
		caption: 'Press space to play/pause. Changing slides pauses playback.',
		type: 'video',
	},
	{
		id: 'rich-image-5',
		src: 'https://picsum.photos/seed/delight-rich-5/1600/1000',
		width: 1600,
		height: 1000,
		name: 'Library spire',
		caption: 'A plain image — the wraparound neighbour of slide 0.',
		type: 'image',
	},
];

/** Just the rich (non-image) items — useful for demos that focus on lazy loading. */
export const richOnlyItems: GalleryItem[] = richMediaItems.filter(
	(item) => typeof item !== 'string' && item.type !== 'image',
);
