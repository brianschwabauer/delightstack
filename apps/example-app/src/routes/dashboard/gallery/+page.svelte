<script lang="ts">
	import {
		Button,
		Modal,
		FileUpload,
		Progress,
		Callout,
		Gallery,
		Carousel,
		Select,
		Toggle,
		type GalleryDisplay,
		type GalleryRadius,
		type GallerySize,
		type GallerySpacing,
		type GalleryItem,
		type GalleryItemAction,
	} from '@delightstack/components';
	import { decodeThumbHash } from '@delightstack/images';
	import Icon from '$lib/Icon.svelte';

	const { data } = $props();
	const { db } = $derived(data);

	let show_upload = $state(false);
	let uploading = $state(false);
	let upload_error = $state('');

	// Live controls so the user can flip through every mode/sizing combo
	let display = $state<GalleryDisplay>('masonry');
	let sizing = $state<GallerySize>('default');
	let spacing = $state<GallerySpacing>('default');
	let radius = $state<GalleryRadius>('small');
	let metaDisplay = $state<'none' | 'always' | 'hover'>('hover');
	let actionDisplay = $state<'none' | 'always' | 'hover'>('hover');
	let fit = $state<'cover' | 'contain'>('cover');
	let useSamples = $state(false);
	let autoplay = $state(false);
	let aspectRatio = $state<'16/9' | '4/3' | '1/1' | 'auto'>('16/9');
	let showCarouselDemo = $state(false);

	const images = db.search('image', { sparse: false });

	// Map the db image records into the new Gallery's generic GalleryItem shape.
	const dbItems = $derived<GalleryItem[]>(
		images.docs.map((image) => {
			const variants = (() => {
				if (!image.variants) return [] as Array<{
					name: string;
					width: number;
					height: number;
					watermarked?: boolean;
				}>;
				if (typeof image.variants !== 'string') return image.variants;
				try {
					return JSON.parse(image.variants);
				} catch {
					return [];
				}
			})();
			const safe = variants
				.filter(
					(v: { name: string; watermarked?: boolean }) =>
						v.name !== 'original' && !v.watermarked,
				)
				.sort((a: { width: number }, b: { width: number }) => a.width - b.width);
			const cdn = '/cdn/image';
			const srcset = safe
				.map(
					(v: { name: string; width: number }) =>
						`${cdn}/${image.id}/${v.name} ${v.width}w`,
				)
				.join(', ');
			const best = [...safe].sort(
				(a: { width: number }, b: { width: number }) => b.width - a.width,
			)[0];
			const url = `${cdn}/${image.id}/${best?.name ?? 'default'}`;
			const thumbnail = image.thumbhash ? decodeThumbHash(image.thumbhash) : undefined;
			const ratio =
				image.aspect_ratio ||
				(image.width && image.height ? image.width / image.height : 1);
			return {
				id: image.id,
				url,
				srcset,
				thumbnail,
				name:
					image.caption || image.file_name?.replace(/\.[^.]+$/, '') || 'Untitled photo',
				ratio,
				type: 'image' as const,
			};
		}),
	);

	// A handful of sample remote images so the gallery can be tested
	// before any local uploads exist. Mixed aspect ratios show off masonry.
	const sampleItems: GalleryItem[] = [
		{ id: 's1', url: 'https://picsum.photos/seed/family01/1600/1067', thumbnail: 'https://picsum.photos/seed/family01/40/27', ratio: 1600 / 1067, name: 'Afternoon walk', type: 'image' },
		{ id: 's2', url: 'https://picsum.photos/seed/family02/1067/1600', thumbnail: 'https://picsum.photos/seed/family02/27/40', ratio: 1067 / 1600, name: 'The reading nook', type: 'image' },
		{ id: 's3', url: 'https://picsum.photos/seed/family03/1600/900', thumbnail: 'https://picsum.photos/seed/family03/40/23', ratio: 16 / 9, name: 'Coastline at sunset', type: 'image' },
		{ id: 's4', url: 'https://picsum.photos/seed/family04/1200/1200', thumbnail: 'https://picsum.photos/seed/family04/30/30', ratio: 1, name: 'Square portrait', type: 'image' },
		{ id: 's5', url: 'https://picsum.photos/seed/family05/1600/1067', thumbnail: 'https://picsum.photos/seed/family05/40/27', ratio: 1600 / 1067, name: 'Mountain trail', type: 'image' },
		{ id: 's6', url: 'https://picsum.photos/seed/family06/900/1600', thumbnail: 'https://picsum.photos/seed/family06/23/40', ratio: 900 / 1600, name: 'Tall pines', type: 'image' },
		{ id: 's7', url: 'https://picsum.photos/seed/family07/1600/1067', thumbnail: 'https://picsum.photos/seed/family07/40/27', ratio: 1600 / 1067, name: 'Old town square', type: 'image' },
		{ id: 's8', url: 'https://picsum.photos/seed/family08/1600/1200', thumbnail: 'https://picsum.photos/seed/family08/40/30', ratio: 4 / 3, name: 'Window light', type: 'image' },
		{ id: 's9', url: 'https://picsum.photos/seed/family09/1600/900', thumbnail: 'https://picsum.photos/seed/family09/40/23', ratio: 16 / 9, name: 'Open road', type: 'image' },
		{ id: 's10', url: 'https://picsum.photos/seed/family10/1067/1600', thumbnail: 'https://picsum.photos/seed/family10/27/40', ratio: 1067 / 1600, name: 'Wildflowers', type: 'image' },
		{ id: 's11', url: 'https://picsum.photos/seed/family11/1600/1067', thumbnail: 'https://picsum.photos/seed/family11/40/27', ratio: 1600 / 1067, name: 'River bend', type: 'image' },
		{ id: 's12', url: 'https://picsum.photos/seed/family12/1600/1067', thumbnail: 'https://picsum.photos/seed/family12/40/27', ratio: 1600 / 1067, name: 'After the rain', type: 'image' },
	];

	const galleryItems = $derived(useSamples || !dbItems.length ? sampleItems : dbItems);

	// One download action per item so the user can test the per-item action ui.
	const galleryActions = $derived<GalleryItemAction[][]>(
		galleryItems.map((item) => {
			const href = typeof item === 'string' ? item : (item.url ?? '');
			return [
				{
					name: 'Download',
					tooltip: 'Download',
					href,
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
			<Button onclick={() => (showCarouselDemo = true)}>
				<span>Open carousel demo</span>
			</Button>
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
				]} />
		</div>
		<div class="control">
			<Select
				label="Sizing"
				bind:value={sizing}
				options={[
					{ value: 'small', label: 'Small' },
					{ value: 'default', label: 'Default' },
					{ value: 'large', label: 'Large' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Spacing"
				bind:value={spacing}
				options={[
					{ value: 'none', label: 'None' },
					{ value: 'default', label: 'Default' },
					{ value: 'large', label: 'Large' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Radius"
				bind:value={radius}
				options={[
					{ value: 'none', label: 'None' },
					{ value: 'small', label: 'Small' },
					{ value: 'large', label: 'Large' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Aspect ratio"
				bind:value={aspectRatio}
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
				bind:value={metaDisplay}
				options={[
					{ value: 'none', label: 'None' },
					{ value: 'hover', label: 'Hover' },
					{ value: 'always', label: 'Always' },
				]} />
		</div>
		<div class="control">
			<Select
				label="Actions"
				bind:value={actionDisplay}
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
			<Toggle bind:checked={useSamples} label="Use sample images" />
		</div>
		<div class="control toggle">
			<Toggle bind:checked={autoplay} label="Autoplay slider" />
		</div>
	</section>

	{#if dbItems.length === 0 && !useSamples}
		<Callout>
			You don't have any uploaded photos yet. The gallery is showing sample images so
			you can try out the new component — toggle <strong>Use sample images</strong>
			off after uploading some.
		</Callout>
	{/if}

	<div class="gallery-wrapper">
		<Gallery
			items={galleryItems}
			{display}
			{sizing}
			{spacing}
			{radius}
			{metaDisplay}
			{actionDisplay}
			{fit}
			{autoplay}
			actions={galleryActions}
			aspectRatio={aspectRatio === 'auto' ? undefined : aspectRatio} />
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

<!-- Standalone Carousel demo (testing the carousel without the gallery wrapper) -->
<Modal
	bind:open={showCarouselDemo}
	title="Carousel — direct usage"
	maxWidth="min(900px, 95vw)"
	maxHeight="80svh">
	<div class="carousel-demo">
		<Carousel items={sampleItems} inline />
	</div>
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

	.carousel-demo {
		height: min(70svh, 600px);
		min-height: 320px;
	}

	.upload-status {
		text-align: center;
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
	}
</style>
