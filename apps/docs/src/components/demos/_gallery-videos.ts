import type { GalleryItem } from '@delightstack/components';

export const videoItems: GalleryItem[] = [
	{
		id: 'video-dog',
		type: 'video',
		src: `https://res.cloudinary.com/demo/video/upload/q_auto,w_640/dog.mp4`,
		width: 640,
		height: 360,
		name: 'Video of dog',
		caption: 'A jack russell inspects the lens, unimpressed',
	},
	{
		id: 'video-bunny',
		type: 'video',
		src: `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`,
		width: 640,
		height: 360,
		name: 'Big Buck Bunny',
		caption: 'Big Buck Bunny — an adaptive HLS stream, captioned over the controls',
	},
];
