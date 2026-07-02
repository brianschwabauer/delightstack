<script lang="ts">
	import { Button, Gallery } from '@delightstack/components';
	import type { BlockProps, UploadedImage } from '../../types/index.js';
	import { icons } from '../../core/icons.js';

	type GalleryAttrs = {
		items: UploadedImage[];
		display: 'grid' | 'masonry' | 'masonry-row' | 'slider' | 'slideshow';
		size: '00' | '0' | '1' | '2' | '3';
		spacing: '0' | '1' | '2' | '3';
		radius: '0' | '1' | '2' | '3';
		block_id: string | null;
	};

	let { attrs, editable, editor, update_attrs }: BlockProps<GalleryAttrs> = $props();

	interface PendingUpload {
		id: string;
		name: string;
		progress: number;
	}

	let pending = $state<PendingUpload[]>([]);
	let input = $state<HTMLInputElement | null>(null);

	// One data shape: attrs.items are UploadResult['image'] objects, mapped to
	// Gallery items here (no parallel snapshot format to keep in sync).
	const gallery_items = $derived(
		attrs.items.map((image) => ({
			id: image.id,
			src: image.srcset || image.src || '',
			width: image.width,
			height: image.height,
			alt: image.alt ?? '',
			thumbhash: image.thumbhash ?? undefined,
		})),
	);

	async function addFiles(files: FileList | null) {
		if (!files?.length || !editor.uploader) return;
		await Promise.all(
			Array.from(files).map(async (file) => {
				const entry: PendingUpload = {
					id: `${file.name}-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
					name: file.name,
					progress: 0,
				};
				pending.push(entry);
				try {
					const result = await editor.uploader!.upload(file, {
						kind: 'image',
						signal: new AbortController().signal,
						on_progress: (fraction) => {
							const current = pending.find((item) => item.id === entry.id);
							if (current) current.progress = fraction;
						},
					});
					if (result.image) {
						update_attrs({ items: [...attrs.items, result.image] });
					}
				} finally {
					pending = pending.filter((item) => item.id !== entry.id);
				}
			}),
		);
	}
</script>

<div class="gallery">
	{#if attrs.items.length}
		<Gallery
			items={gallery_items}
			display={attrs.display}
			size={attrs.size}
			spacing={attrs.spacing}
			radius={attrs.radius} />
	{/if}

	{#if pending.length}
		<div class="pending" contenteditable="false">
			{#each pending as entry (entry.id)}
				<div class="upload">
					<span class="name">{entry.name}</span>
					<span class="bar">
						<span class="fill" style:width="{Math.round(entry.progress * 100)}%"></span>
					</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if editable && editor.uploader}
		<div class="actions" contenteditable="false">
			<Button dense outline size="0" onclick={() => input?.click()}>
				<span class="icon">{@html icons.plus}</span>
				Add images
			</Button>
			<input
				type="file"
				accept="image/*"
				multiple
				hidden
				bind:this={input}
				onchange={(event) => {
					addFiles(event.currentTarget.files);
					event.currentTarget.value = '';
				}} />
		</div>
	{/if}

	{#if !attrs.items.length && !pending.length && !editable}
		<div class="empty">Empty gallery</div>
	{/if}
</div>

<style>
	.gallery {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.pending {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.upload {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius, 8px);
		background: var(--color-bg-muted, color-mix(in oklab, currentColor 6%, transparent));
		font-size: 0.8125rem;
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
		block-size: 5px;
		border-radius: 3px;
		background: color-mix(in oklab, currentColor 12%, transparent);
		overflow: hidden;
	}

	.fill {
		display: block;
		block-size: 100%;
		border-radius: inherit;
		background: var(--action, var(--color-primary));
		transition: width 200ms ease;
	}

	.icon {
		display: inline-grid;
		place-items: center;
		inline-size: 1rem;
		block-size: 1rem;
		margin-inline-end: 0.375rem;

		:global(svg) {
			inline-size: 100%;
			block-size: 100%;
		}
	}

	.empty {
		padding: 1.5rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		border: 1px dashed
			var(--color-border, color-mix(in oklab, currentColor 20%, transparent));
		border-radius: var(--radius, 8px);
	}
</style>
