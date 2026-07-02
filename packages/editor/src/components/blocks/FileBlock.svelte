<script lang="ts">
	import type { BlockProps } from '../../types/index.js';
	import { icons } from '../../core/icons.js';
	import MediaUploadFrame from './MediaUploadFrame.svelte';

	type FileAttrs = {
		src: string;
		name: string;
		size: number | null;
		mime: string;
		uploading: boolean;
		upload_id: string | null;
		blob_url: string | null;
		upload_error: string | null;
		block_id: string | null;
	};

	let { attrs, editor, delete_node }: BlockProps<FileAttrs> = $props();

	function formatSize(bytes: number | null): string {
		if (!bytes) return '';
		const units = ['B', 'KB', 'MB', 'GB'];
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
	}
</script>

<div class="file">
	<MediaUploadFrame
		{editor}
		upload_id={attrs.upload_id}
		upload_error={attrs.upload_error}
		file_name={attrs.name}
		{delete_node}>
		<a href={attrs.src} download={attrs.name} contenteditable="false">
			<span class="icon">{@html icons.file}</span>
			<span class="meta">
				<span class="name">{attrs.name}</span>
				{#if attrs.size}
					<span class="size">{formatSize(attrs.size)}</span>
				{/if}
			</span>
		</a>
	</MediaUploadFrame>
</div>

<style>
	.file a {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius, 8px);
		background: var(--color-bg-muted, color-mix(in oklab, currentColor 6%, transparent));
		border: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 12%, transparent));
		color: inherit;
		text-decoration: none;
		transition: background-color 300ms ease;

		&:hover {
			background: var(
				--color-bg-active,
				color-mix(in oklab, currentColor 10%, transparent)
			);
			transition: none;
		}
	}

	.icon {
		flex: 0 0 auto;
		inline-size: 1.5rem;
		block-size: 1.5rem;
		color: var(--color-text-muted);

		:global(svg) {
			inline-size: 100%;
			block-size: 100%;
		}
	}

	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.name {
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.size {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
