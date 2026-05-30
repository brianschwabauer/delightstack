import type { GalleryItem } from '@delightstack/components';

export const videoItems: GalleryItem[] = [
	{
		id: 'video-dog',
		type: 'video',
		src: `https://res.cloudinary.com/demo/video/upload/q_auto,w_640/dog.mp4`,
		width: 640,
		height: 360,
		name: 'Video of dog',
	},
	{
		id: 'video-bunny',
		type: 'video',
		src: `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`,
		width: 640,
		height: 360,
		name: 'Big Buck Bunny',
	},
];
