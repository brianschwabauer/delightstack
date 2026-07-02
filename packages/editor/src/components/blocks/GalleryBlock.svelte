<script lang="ts">
	import { flip } from 'svelte/animate';
	import { Button, Gallery } from '@delightstack/components';
	import type { BlockProps, UploadedImage } from '../../types/index.js';
	import { icons } from '../../core/icons.js';

	type GalleryAttrs = {
		items: UploadedImage[];
		display: 'grid' | 'masonry' | 'masonry-row' | 'slider' | 'slideshow' | 'list';
		size: '00' | '0' | '1' | '2' | '3';
		spacing: '0' | '1' | '2' | '3';
		radius: '0' | '1' | '2' | '3';
		fit: 'contain' | 'cover';
		captions: 'none' | 'hover' | 'always';
		width_pct: number | null;
		width_mode: 'normal' | 'wide' | 'full';
		block_id: string | null;
	};

	let { attrs, editable, selected, editor, update_attrs, ui }: BlockProps<GalleryAttrs> =
		$props();

	interface PendingUpload {
		id: string;
		name: string;
		progress: number;
		error: string | null;
		/** Retained so a failed upload can be retried without re-picking */
		file: File;
		controller: AbortController;
	}

	let pending = $state<PendingUpload[]>([]);
	let input = $state<HTMLInputElement | null>(null);

	// Manage mode lives in the shared node-view UI state so the chrome
	// actions (hover bubble) can toggle it; leaving the block exits it.
	const managing = $derived(Boolean(ui.managing) && editable);

	const flip_duration =
		typeof matchMedia === 'function' &&
		matchMedia('(prefers-reduced-motion: reduce)').matches
			? 0
			: 200;

	$effect(() => {
		ui.add_images = () => input?.click();
		return () => {
			delete ui.add_images;
		};
	});

	$effect(() => {
		if (!selected && ui.managing) ui.managing = false;
	});

	// One data shape: attrs.items are UploadResult['image'] objects, mapped to
	// Gallery items here (no parallel snapshot format to keep in sync).
	const gallery_items = $derived(
		attrs.items.map((image) => ({
			id: image.id,
			src: image.srcset || image.src || '',
			width: image.width,
			height: image.height,
			alt: image.alt ?? '',
			// `name` drives the Gallery's thumbnail overlay (meta_display);
			// `caption` drives the lightbox/carousel overlay
			name: image.caption || undefined,
			caption: image.caption || undefined,
			thumbhash: image.thumbhash ?? undefined,
		})),
	);

	// ---- item management (reorder / caption / remove) ----

	// During a reorder drag the rows render from this live copy; the reorder
	// is committed as a single transaction on release.
	let live_items = $state<UploadedImage[] | null>(null);
	let drag_index = $state<number | null>(null);
	let rows_el = $state<HTMLElement | null>(null);

	const view_items = $derived(live_items ?? attrs.items);

	// Slot geometry snapshotted at drag start (relative to the list, so it
	// survives scrolling). Live rects lie while rows are mid-FLIP-animation —
	// measuring them made the target index flip-flop and rows reorder on
	// their own. All pointer math runs against this static grid instead.
	let slot_centers: number[] = [];

	function startReorder(event: PointerEvent, index: number) {
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		if (!rows_el) return;
		const list_top = rows_el.getBoundingClientRect().top;
		slot_centers = Array.from(rows_el.querySelectorAll('[data-row]')).map((row) => {
			const rect = row.getBoundingClientRect();
			return rect.top - list_top + rect.height / 2;
		});
		live_items = [...attrs.items];
		drag_index = index;
	}

	function moveReorder(event: PointerEvent) {
		if (drag_index === null || !live_items || !rows_el || !slot_centers.length) return;
		const y = event.clientY - rows_el.getBoundingClientRect().top;
		// Nearest static slot center wins — a pure function of the pointer, so
		// the target can never oscillate mid-animation.
		let target = 0;
		for (let index = 1; index < slot_centers.length; index++) {
			if (Math.abs(y - slot_centers[index]) < Math.abs(y - slot_centers[target])) {
				target = index;
			}
		}
		if (target !== drag_index) {
			const list = [...live_items];
			const [moved] = list.splice(drag_index, 1);
			list.splice(target, 0, moved);
			live_items = list;
			drag_index = target;
		}
	}

	function endReorder() {
		if (drag_index === null) return;
		const list = live_items;
		drag_index = null;
		live_items = null;
		if (list) update_attrs({ items: list });
	}

	function keyboardReorder(event: KeyboardEvent, index: number) {
		const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!direction) return;
		event.preventDefault();
		event.stopPropagation();
		const target = index + direction;
		if (target < 0 || target >= attrs.items.length) return;
		const list = [...attrs.items];
		const [moved] = list.splice(index, 1);
		list.splice(target, 0, moved);
		// The handle element survives the keyed flip, so focus follows the row
		update_attrs({ items: list });
	}

	function setCaption(id: string, caption: string) {
		update_attrs({
			items: attrs.items.map((item) => (item.id === id ? { ...item, caption } : item)),
		});
	}

	function removeItem(id: string) {
		const items = attrs.items.filter((item) => item.id !== id);
		update_attrs({ items });
		if (!items.length) ui.managing = false;
	}

	function addFiles(files: FileList | null) {
		if (!files?.length || !editor.uploader) return;
		for (const file of Array.from(files)) {
			const entry: PendingUpload = {
				id: `${file.name}-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
				name: file.name,
				progress: 0,
				error: null,
				file,
				controller: new AbortController(),
			};
			pending.push(entry);
			void runUpload(entry);
		}
	}

	function appendItem(image: UploadedImage) {
		// A reorder drag renders (and later commits) `live_items` — append to
		// the live copy too or the drag's commit would drop the new image
		if (live_items) live_items = [...live_items, image];
		update_attrs({ items: [...attrs.items, image] });
	}

	async function runUpload(entry: PendingUpload) {
		try {
			const result = await editor.uploader!.upload(entry.file, {
				kind: 'image',
				signal: entry.controller.signal,
				on_progress: (fraction) => {
					const current = pending.find((item) => item.id === entry.id);
					if (current) current.progress = fraction;
				},
			});
			if (result.image) appendItem(result.image);
			pending = pending.filter((item) => item.id !== entry.id);
		} catch (error) {
			if (entry.controller.signal.aborted) {
				pending = pending.filter((item) => item.id !== entry.id);
				return;
			}
			// Keep the row with an error + retry — a failed upload must never
			// silently vanish
			const current = pending.find((item) => item.id === entry.id);
			if (current) {
				current.error = error instanceof Error ? error.message : 'Upload failed';
			}
		}
	}

	function retryUpload(entry: PendingUpload) {
		entry.error = null;
		entry.progress = 0;
		entry.controller = new AbortController();
		void runUpload(entry);
	}

	function dismissUpload(entry: PendingUpload) {
		entry.controller.abort();
		pending = pending.filter((item) => item.id !== entry.id);
	}
</script>

<div class="gallery" data-resize-anchor>
	{#if attrs.items.length && !managing}
		<Gallery
			items={gallery_items}
			display={attrs.display}
			size={attrs.size}
			spacing={attrs.spacing}
			radius={attrs.radius}
			fit={attrs.fit}
			meta_display={attrs.captions ?? 'hover'}
			meta_display_fullscreen={attrs.captions === 'none' ? 'none' : 'always'} />
	{/if}

	{#if pending.length}
		<div class="pending" contenteditable="false">
			{#each pending as entry (entry.id)}
				<div class="upload" class:failed={entry.error}>
					<span class="name">{entry.name}</span>
					{#if entry.error}
						<span class="error-text">{entry.error}</span>
						<Button dense transparent size="0" onclick={() => retryUpload(entry)}>
							Retry
						</Button>
						<Button dense transparent error size="0" onclick={() => dismissUpload(entry)}>
							Remove
						</Button>
					{:else}
						<span class="bar">
							<span class="fill" style:scale="{Math.max(0.005, entry.progress)} 1"></span>
						</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if managing && attrs.items.length}
		<div class="manage" contenteditable="false" bind:this={rows_el}>
			{#each view_items as item, index (item.id)}
				<div
					class="row"
					class:dragging={drag_index === index}
					data-row
					animate:flip={{ duration: flip_duration }}>
					<button
						type="button"
						class="handle"
						aria-label="Reorder (drag, or arrow keys when focused)"
						onkeydown={(event) => keyboardReorder(event, index)}
						onpointerdown={(event) => startReorder(event, index)}
						onpointermove={moveReorder}
						onpointerup={endReorder}
						onpointercancel={endReorder}>
						{@html icons.drag}
					</button>
					<img
						class="thumb"
						src={item.srcset?.split(' ')[0] || item.src}
						alt={item.alt ?? ''}
						draggable="false" />
					<input
						class="caption"
						type="text"
						placeholder="Add a caption…"
						value={item.caption ?? ''}
						onchange={(event) => setCaption(item.id, event.currentTarget.value.trim())}
						onkeydown={(event) => {
							if (event.key === 'Enter') event.currentTarget.blur();
							event.stopPropagation();
						}} />
					<Button
						icon
						transparent
						dense
						size="0"
						aria-label="Remove image"
						tooltip="Remove"
						onclick={() => removeItem(item.id)}>
						{@html icons.trash}
					</Button>
				</div>
			{/each}
		</div>
	{/if}

	{#if editable && editor.uploader}
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
	{/if}

	{#if !attrs.items.length && !pending.length}
		<div class="empty" contenteditable="false">
			{#if editable && editor.uploader}
				<Button dense outline size="0" onclick={() => input?.click()}>
					<span class="icon">{@html icons.plus}</span>
					Add images
				</Button>
			{:else}
				Empty gallery
			{/if}
		</div>
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
		inline-size: 100%;
		border-radius: inherit;
		background: var(--action, var(--color-primary));
		/* scale, not width: progress must never trigger layout */
		scale: 0.005 1;
		transform-origin: left center;
		transition: scale 200ms ease;
	}

	.failed {
		background: color-mix(in oklab, var(--color-error, #ef4444) 8%, transparent);
	}

	.error-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-error, #ef4444);
		font-size: 0.75rem;
	}

	.manage {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.375rem;
		border-radius: var(--radius, 8px);
		border: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 12%, transparent));
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem;
		border-radius: calc(var(--radius, 8px) - 2px);
		background: var(--color-surface, Canvas);

		&.dragging {
			background: var(
				--color-bg-active,
				color-mix(in oklab, currentColor 6%, transparent)
			);
			box-shadow: var(--shadow-md, 0 2px 8px rgb(0 0 0 / 10%));
			position: relative;
			z-index: 1;
		}
	}

	.handle {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		inline-size: 1.5rem;
		block-size: 1.5rem;
		padding: 0.2rem;
		border: none;
		background: none;
		color: var(--color-text-muted);
		cursor: grab;
		touch-action: none;

		&:active {
			cursor: grabbing;
		}

		:global(svg) {
			inline-size: 100%;
			block-size: 100%;
		}
	}

	.thumb {
		flex: 0 0 auto;
		inline-size: 2.5rem;
		block-size: 2.5rem;
		object-fit: cover;
		border-radius: calc(var(--radius, 8px) / 2);
		user-select: none;
	}

	.caption {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		font: inherit;
		font-size: 0.8125rem;
		color: inherit;
		outline: none;
		padding: 0.25rem;
		border-radius: calc(var(--radius, 8px) / 2);

		/* outline: none needs a replacement for keyboard focus */
		&:focus-visible {
			box-shadow: inset 0 -2px 0 var(--action, var(--color-primary));
		}

		&::placeholder {
			color: var(
				--color-text-disabled,
				color-mix(in oklab, currentColor 40%, transparent)
			);
		}
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
