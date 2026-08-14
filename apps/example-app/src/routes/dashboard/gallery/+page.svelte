<script lang="ts">
	import {
		Button,
		Modal,
		FileUpload,
		Progress,
		Callout,
		Gallery,
		pickLargestSrc,
		Select,
		Toggle,
		type GalleryDisplay,
		type GalleryRadius,
		type GallerySize,
		type GallerySpacing,
		type GalleryItem,
		type GalleryItemAction,
	} from '@delightstack/components';
	import { toImageProps } from '@delightstack/images';
	import Icon from '$lib/Icon.svelte';

	const { data } = $props();
	const { db } = $derived(data);

	let show_upload = $state(false);
	let uploading = $state(false);
	let upload_error = $state('');
	let gallery = $state<ReturnType<typeof Gallery>>();
	let lightbox_slide = $state(-1);

	// Live controls so the user can flip through every mode/sizing combo
	let display = $state<GalleryDisplay>('masonry');
	let size = $state<GallerySize>('1');
	let spacing = $state<GallerySpacing>('1');
	let radius = $state<GalleryRadius>('1');
	let meta_display = $state<'none' | 'always' | 'hover'>('hover');
	let meta_display_fullscreen = $state<'none' | 'always'>('always');
	let action_display = $state<'none' | 'always' | 'hover'>('hover');
	let fit = $state<'cover' | 'contain'>('cover');
	let autoplay = $state(false);
	let aspect_ratio = $state<'16/9' | '4/3' | '1/1' | 'auto'>('16/9');

	// The db client is stable for the life of the page — capturing it once to
	// create the live search query is intentional.
	// svelte-ignore state_referenced_locally
	const images = db.watch('image', { sparse: false });

	// Map the db image records into the Gallery's generic item shape via the
	// `@delightstack/images` helper. The Gallery's `src` field accepts the
	// combined srcset string directly, so we prefer it over the single src.
	const galleryItems = $derived<GalleryItem[]>(
		images.docs.map((image, index) => {
			// Search docs type their primary key as `DocumentID | undefined`
			// (string | number); the image helpers and Gallery items want strings.
			const props = toImageProps({ ...image, id: String(image.id ?? '') });
			return {
				id: image.id == null ? undefined : String(image.id),
				src: props.srcset || props.src,
				thumbhash: props.thumbhash,
				alt: props.alt,
				width: props.width,
				height: props.height,
				name: image.file_name?.replace(/\.[^.]+$/, '') || 'Untitled photo',
				caption: image.caption || undefined,
				type: 'image' as const,
				// First row above the fold gets eager loading + high fetch priority.
				priority: index < 6,
			};
		}),
	);

	// One download action per item so the user can test the per-item action ui.
	const galleryActions = $derived<GalleryItemAction[][]>(
		galleryItems.map((item) => {
			const src = typeof item === 'string' ? item : (item.src ?? '');
			return [
				{
					name: 'Download',
					tooltip: 'Download',
					href: pickLargestSrc(src),
					target: '_blank' as const,
				},
			];
		}),
	);

	async function handleUpload(detail: { files: File[] }) {
		if (!detail.files.length) return;
		uploading = true;
		upload_error = '';
		try {
			for (const file of detail.files) {
				await db.uploadImage(file, { caption: file.name });
			}
			show_upload = false;
		} catch (e) {
			upload_error = e instanceof Error ? e.message : 'Failed to upload image';
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
		<div class="header-actions">
			<Button onclick={() => (show_upload = true)}>
				<Icon name="plus" size={16} />
				<span>Upload photos</span>
			</Button>
		</div>
	</header>

	<section class="controls">
		<div class="control">
			<Select
				label="Display"
				bind:value={display}
				options={[
					{ value: 'masonry', label: 'Masonry' },
					{ value: 'masonry-row', label: 'Masonry (rows)' },
					{ value: 'grid', label: 'Grid' },
					{ value: 'list', label: 'List' },
					{ value: 'slider', label: 'Slider' },
					{ value: 'slideshow', label: 'Slideshow' },
					{ value: 'lightbox', label: 'Lightbox (custom thumbs)' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Size"
				bind:value={size}
				options={[
					{ value: '0', label: 'Small' },
					{ value: '1', label: 'Default' },
					{ value: '2', label: 'Large' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Spacing"
				bind:value={spacing}
				options={[
					{ value: '0', label: 'None' },
					{ value: '1', label: 'Default' },
					{ value: '2', label: 'Large' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Radius"
				bind:value={radius}
				options={[
					{ value: '0', label: 'None' },
					{ value: '1', label: 'Small' },
					{ value: '2', label: 'Large' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Aspect ratio"
				bind:value={aspect_ratio}
				options={[
					{ value: '16/9', label: '16:9' },
					{ value: '4/3', label: '4:3' },
					{ value: '1/1', label: '1:1' },
					{ value: 'auto', label: 'auto' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Meta"
				bind:value={meta_display}
				options={[
					{ value: 'none', label: 'None' },
					{ value: 'hover', label: 'Hover' },
					{ value: 'always', label: 'Always' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Caption (modal)"
				bind:value={meta_display_fullscreen}
				options={[
					{ value: 'none', label: 'None' },
					{ value: 'always', label: 'Always' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Actions"
				bind:value={action_display}
				options={[
					{ value: 'none', label: 'None' },
					{ value: 'hover', label: 'Hover' },
					{ value: 'always', label: 'Always' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Fit"
				bind:value={fit}
				options={[
					{ value: 'cover', label: 'Cover' },
					{ value: 'contain', label: 'Contain' },
				]} />
		</div>
		<div class="control toggle">
			<Toggle bind:checked={autoplay} label="Autoplay slider" />
		</div>
	</section>

	{#if galleryItems.length === 0 && images.status !== 'loading'}
		<Callout>
			You don't have any uploaded photos yet. Click <strong>Upload photos</strong>
			to add some — uploaded images will show their thumbhash blur while the full-resolution
			version loads.
		</Callout>
	{/if}

	<div class="gallery-wrapper">
		{#if display === 'lightbox'}
			<p class="lightbox-hint">
				In <code>display="lightbox"</code>
				the Gallery renders nothing of its own — the thumbnail layout below is plain HTML from
				this page. Clicking a tile calls
				<code>gallery.open(index, event.currentTarget)</code>
				which opens the carousel with an animation anchored to the tile.
			</p>
			<div class="custom-thumbs">
				{#each galleryItems as item, i (typeof item === 'string' ? i : (item.id ?? i))}
					{@const img = typeof item === 'string' ? { src: item } : item}
					<button
						type="button"
						class="custom-thumb"
						onclick={(e) => gallery?.open(i, e.currentTarget)}>
						<img src={pickLargestSrc(img.src ?? '')} alt={img.alt ?? ''} />
					</button>
				{/each}
			</div>
		{/if}

		<Gallery
			bind:this={gallery}
			bind:slide={lightbox_slide}
			items={galleryItems}
			{display}
			{size}
			{spacing}
			{radius}
			{meta_display}
			{meta_display_fullscreen}
			{action_display}
			{fit}
			{autoplay}
			actions={galleryActions}
			aspect_ratio={aspect_ratio === 'auto' ? undefined : aspect_ratio} />
	</div>
</div>

<!-- Upload Modal -->
<Modal bind:open={show_upload} title="Upload Photos">
	{#if upload_error}
		<Callout error>{upload_error}</Callout>
	{/if}

	<FileUpload accept="image/*" multiple onselect={handleUpload} />

	{#if uploading}
		<Progress loading />
		<p class="upload-status">Uploading...</p>
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
		h1 {
			font-family: var(--font-serif);
			font-size: var(--font-size-4);
			letter-spacing: -0.01em;
		}
		p {
			color: var(--color-text-disabled);
		}
	}
	.header-actions {
		display: flex;
		gap: var(--size-2);
		flex-wrap: wrap;
	}

	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: var(--size-3);
		padding: var(--size-3);
		border-radius: var(--radius-3);
		background: var(--color-surface-2, var(--color-bg-2, rgba(0, 0, 0, 0.03)));
	}
	.control.toggle {
		display: flex;
		align-items: center;
	}

	.gallery-wrapper {
		min-height: 400px;
	}

	.lightbox-hint {
		font-size: var(--font-size-0);
		color: var(--color-text-disabled);
		margin: 0 0 var(--size-3);
		padding: var(--size-3);
		border-radius: var(--radius-2);
		background: var(--color-surface-2, var(--color-bg-2, rgba(0, 0, 0, 0.03)));
		code {
			font-family: var(--font-mono, monospace);
			font-size: 0.95em;
			padding: 0 0.25em;
			border-radius: 3px;
			background: rgba(0, 0, 0, 0.06);
		}
	}

	.custom-thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: var(--size-2);
	}
	.custom-thumb {
		all: unset;
		display: block;
		aspect-ratio: 1;
		border-radius: var(--radius-3);
		overflow: hidden;
		cursor: pointer;
		position: relative;
		transition:
			transform 150ms ease,
			box-shadow 150ms ease;
		box-shadow: var(--shadow-1, 0 1px 3px rgba(0, 0, 0, 0.1));
		img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
		}
		&:hover {
			transform: translateY(-2px);
			box-shadow: var(--shadow-2, 0 4px 12px rgba(0, 0, 0, 0.15));
		}
		&:focus-visible {
			outline: 2px solid var(--color-text, currentColor);
			outline-offset: 2px;
		}
	}

	.upload-status {
		text-align: center;
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
	}
</style>
