<script lang="ts">
	import { Button, Modal, FileUpload, Progress, Callout } from '@delightstack/components';
	import Image from '@delightstack/images/component';

	const { data } = $props();
	const { db } = $derived(data);

	let show_upload = $state(false);
	let uploading = $state(false);
	let upload_error = $state('');
	let selected_image: Record<string, unknown> | null = $state(null);
	let show_preview = $state(false);

	const images = $derived(
		db.search('image', {
			limit: 100,
			sortBy: { property: 'created_at', order: 'DESC' },
		}),
	);

	async function handleUpload(files: FileList | null) {
		if (!files?.length) return;
		uploading = true;
		upload_error = '';

		try {
			for (const file of files) {
				const form_data = new FormData();
				form_data.append('file', file);
				form_data.append('caption', file.name);

				const response = await fetch('/api/image', {
					method: 'POST',
					body: form_data,
				});

				if (!response.ok) {
					const err = await response.json();
					upload_error = err.message || 'Upload failed';
					return;
				}
			}
			show_upload = false;
		} catch {
			upload_error = 'Failed to upload image';
		} finally {
			uploading = false;
		}
	}
</script>

<svelte:head>
	<title>Gallery | Forever Family</title>
</svelte:head>

<div class="page">
	<header>
		<div>
			<h1>Family Gallery</h1>
			<p>Photos and memories</p>
		</div>
		<Button onclick={() => (show_upload = true)}>Upload Photos</Button>
	</header>

	<div class="gallery-grid">
		{#if images.loaded && images.docs.length === 0}
			<div class="empty">
				<p>No photos yet. Upload some family memories!</p>
				<Button onclick={() => (show_upload = true)}>Upload Photos</Button>
			</div>
		{:else}
			{#each images.docs as image}
				<button
					class="gallery-item"
					onclick={() => { selected_image = image; show_preview = true; }}
				>
					<Image {image} variant="thumbnail" />
					{#if image.caption}
						<span class="caption">{image.caption}</span>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
</div>

<!-- Upload Modal -->
<Modal bind:open={show_upload} title="Upload Photos">
	{#if upload_error}
		<Callout type="error">{upload_error}</Callout>
	{/if}

	<FileUpload
		accept="image/*"
		multiple
		onchange={(e) => handleUpload(e.currentTarget.files)}
	/>

	{#if uploading}
		<Progress indeterminate />
		<p class="upload-status">Uploading...</p>
	{/if}
</Modal>

<!-- Image Preview Modal -->
<Modal bind:open={show_preview} title={selected_image?.caption ?? 'Photo'} onclose={() => { selected_image = null; }}>
	{#if selected_image}
		<div class="preview">
			<Image image={selected_image} />
		</div>
	{/if}
</Modal>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-5);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--size-3);
		flex-wrap: wrap;
		p { color: var(--color-text-disabled); }
	}
	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--size-2);
	}
	.gallery-item {
		aspect-ratio: 1;
		overflow: hidden;
		border-radius: var(--radius-3);
		cursor: pointer;
		position: relative;
		border: none;
		padding: 0;
		background: var(--color-bg-3);
		transition: transform 0.15s;
		&:hover { transform: scale(1.02); }
	}
	.caption {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: var(--size-2);
		background: linear-gradient(transparent, rgba(0 0 0 / 0.6));
		color: white;
		font-size: var(--font-size-00);
	}
	.empty {
		grid-column: 1 / -1;
		text-align: center;
		padding: var(--size-9) 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--size-3);
		p { color: var(--color-text-disabled); }
	}
	.upload-status {
		text-align: center;
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
	}
	.preview {
		max-height: 70vh;
		display: flex;
		justify-content: center;
	}
</style>
