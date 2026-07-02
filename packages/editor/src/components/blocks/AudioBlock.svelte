<script lang="ts">
	import type { BlockProps } from '../../types/index.js';
	import MediaUploadFrame from './MediaUploadFrame.svelte';

	type AudioAttrs = {
		src: string;
		name: string;
		uploading: boolean;
		upload_id: string | null;
		blob_url: string | null;
		upload_error: string | null;
		block_id: string | null;
	};

	let { attrs, editor, delete_node }: BlockProps<AudioAttrs> = $props();
</script>

<figure class="audio">
	<MediaUploadFrame
		{editor}
		upload_id={attrs.upload_id}
		upload_error={attrs.upload_error}
		file_name={attrs.name}
		{delete_node}>
		<audio src={attrs.src} controls preload="metadata"></audio>
		{#if attrs.name}
			<figcaption>{attrs.name}</figcaption>
		{/if}
	</MediaUploadFrame>
</figure>

<style>
	.audio {
		margin: 0;

		audio {
			display: block;
			inline-size: 100%;
		}
	}

	figcaption {
		margin-block-start: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
