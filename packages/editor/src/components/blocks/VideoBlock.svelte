<script lang="ts">
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
		<!-- svelte-ignore a11y_media_has_caption -->
		<video src={attrs.src} controls preload="metadata"></video>
	</MediaUploadFrame>
</figure>

<style>
	.video {
		margin: 0;

		video {
			display: block;
			inline-size: 100%;
			border-radius: var(--radius, 8px);
			background: black;

			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius, 8px) * var(--squircle-ratio, 2));
			}
		}
	}
</style>
