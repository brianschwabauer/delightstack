<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '@delightstack/components';
	import type { EditorLike } from '../../types/index.js';

	interface Props {
		editor: EditorLike;
		upload_id: string | null;
		upload_error: string | null;
		file_name?: string;
		delete_node: () => void;
		children: Snippet;
	}

	let {
		editor,
		upload_id,
		upload_error,
		file_name = '',
		delete_node,
		children,
	}: Props = $props();

	const upload = $derived(
		upload_id ? editor.uploads.find((entry) => entry.upload_id === upload_id) : undefined,
	);
	const uploading = $derived(Boolean(upload_id) && !upload_error);
	const percent = $derived(Math.round((upload?.progress ?? 0) * 100));
</script>

{#if upload_error}
	<div class="error" contenteditable="false">
		<span>Upload failed{file_name ? ` — ${file_name}` : ''}</span>
		<Button dense transparent error size="0" onclick={() => delete_node()}>Remove</Button>
	</div>
{:else if uploading}
	<div class="uploading" contenteditable="false">
		<span class="name">{file_name || 'Uploading…'}</span>
		<span class="bar">
			<span class="fill" style:scale="{Math.max(0.005, upload?.progress ?? 0)} 1"></span>
		</span>
		<span class="percent">{percent}%</span>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.uploading {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: var(--radius, 8px);
		background: var(--color-bg-muted, color-mix(in oklab, currentColor 6%, transparent));
		font-size: 0.875rem;
	}

	.name {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bar {
		flex: 1;
		block-size: 6px;
		border-radius: 3px;
		background: color-mix(in oklab, currentColor 12%, transparent);
		overflow: hidden;
	}

	.fill {
		display: block;
		block-size: 100%;
		inline-size: 100%;
		border-radius: inherit;
		background: var(--action, var(--color-primary));
		/* scale, not width: progress must never trigger layout */
		scale: 0.005 1;
		transform-origin: left center;
		transition: scale 200ms ease;
	}

	.percent {
		flex: 0 0 auto;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: var(--radius, 8px);
		background: color-mix(in oklab, var(--color-error, #ef4444) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--color-error, #ef4444) 35%, transparent);
		font-size: 0.875rem;
	}
</style>
