<script lang="ts">
	import { Video } from '@delightstack/components';
	import type { BlockProps } from '../../types/index.js';
	import MediaUploadFrame from './MediaUploadFrame.svelte';

	type VideoAttrs = {
		src: string;
		name: string;
		uploading: boolean;
		upload_id: string | null;
		blob_url: string | null;
		upload_error: string | null;
		block_id: string | null;
	};

	let { attrs, editor, delete_node }: BlockProps<VideoAttrs> = $props();
</script>

<figure class="video">
	<MediaUploadFrame
		{editor}
		upload_id={attrs.upload_id}
		upload_error={attrs.upload_error}
		file_name={attrs.name}
		{delete_node}>
		<div class="player" contenteditable="false">
			<Video src={attrs.src} preload="metadata" />
		</div>
	</MediaUploadFrame>
</figure>

<style>
	.video {
		margin: 0;
	}

	.player {
		border-radius: var(--radius, 8px);
		overflow: hidden;

		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius, 8px) * var(--squircle-ratio, 2));
		}
	}
</style>
