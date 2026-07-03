<script lang="ts">
	import { Button, Gallery } from '@delightstack/components';
	import { decodeThumbHash } from '@delightstack/components/media';
	import type { BlockProps } from '../../types/index.js';

	type ImageAttrs = {
		src: string;
		srcset: string | null;
		image_id: string | null;
		alt: string;
		caption: string;
		width: number | null;
		height: number | null;
		aspect_ratio: number | null;
		thumbhash: string | null;
		background_color: string | null;
		width_pct: number | null;
		width_mode: 'normal' | 'wide' | 'full';
		crop_aspect: number | null;
		focal_x: number;
		focal_y: number;
		uploading: boolean;
		upload_id: string | null;
		blob_url: string | null;
		upload_error: string | null;
		block_id: string | null;
	};

	let {
		attrs,
		editable,
		selected,
		editor,
		update_attrs,
		delete_node,
		ui,
	}: BlockProps<ImageAttrs> = $props();

	const upload = $derived(
		attrs.upload_id
			? editor.uploads.find((entry) => entry.upload_id === attrs.upload_id)
			: undefined,
	);
	const progress = $derived(upload?.progress ?? 0);
	const aspect_ratio = $derived(
		attrs.aspect_ratio ??
			(attrs.width && attrs.height ? attrs.width / attrs.height : undefined),
	);

	// ---- crop + focal point ----
	const cropped = $derived(attrs.crop_aspect != null && !attrs.uploading);
	const effective_ratio = $derived(cropped ? attrs.crop_aspect : aspect_ratio);
	/** Live focal preview while dragging (committed on pointer release) */
	let focal_live = $state<{ x: number; y: number } | null>(null);
	const focal = $derived.by(() => {
		const x = focal_live?.x ?? attrs.focal_x ?? 50;
		const y = focal_live?.y ?? attrs.focal_y ?? 50;
		return `${Math.round(x)}% ${Math.round(y)}%`;
	});

	// Reposition mode: drag the image to choose what the crop keeps.
	// Registered on the shared ui state so the chrome "Reposition" action and
	// the mode toolbar (both defined in the block spec) can drive it. While
	// active, `ui.chrome_mode` swaps the block toolbar for the mode's actions.
	let repositioning = $state(false);
	let reposition_el = $state<HTMLElement | null>(null);
	let pan_last: { x: number; y: number } | null = null;

	$effect(() => {
		ui.reposition = () => {
			repositioning = !repositioning;
			if (!repositioning) focal_live = null;
		};
		return () => {
			delete ui.reposition;
		};
	});

	$effect(() => {
		ui.repositioning = repositioning;
		ui.chrome_mode = repositioning ? 'reposition' : undefined;
	});

	// Live x/y readout for the mode toolbar (attrs alone would lag the drag)
	$effect(() => {
		ui.focal_label = focal;
	});

	// Leaving the block (or clearing the crop) exits reposition mode
	$effect(() => {
		if ((!selected || !cropped) && repositioning) {
			repositioning = false;
			focal_live = null;
		}
	});

	function panStart(event: PointerEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		pan_last = { x: event.clientX, y: event.clientY };
	}

	function panMove(event: PointerEvent) {
		if (!pan_last || !reposition_el || !attrs.width || !attrs.height) return;
		const box = reposition_el.getBoundingClientRect();
		// Cover scale: how far the image overflows the cropped box decides
		// how much a pixel of drag moves the focus (sign-flipped — dragging
		// the image right reveals more of the left)
		const scale = Math.max(box.width / attrs.width, box.height / attrs.height);
		const overflow_x = attrs.width * scale - box.width;
		const overflow_y = attrs.height * scale - box.height;
		const dx = event.clientX - pan_last.x;
		const dy = event.clientY - pan_last.y;
		pan_last = { x: event.clientX, y: event.clientY };
		const current = focal_live ?? {
			x: attrs.focal_x ?? 50,
			y: attrs.focal_y ?? 50,
		};
		focal_live = {
			x:
				overflow_x > 1
					? Math.max(0, Math.min(100, current.x - (dx / overflow_x) * 100))
					: current.x,
			y:
				overflow_y > 1
					? Math.max(0, Math.min(100, current.y - (dy / overflow_y) * 100))
					: current.y,
		};
	}

	// Each drag commits on release — the mode has no explicit "save", so
	// exiting (toolbar, Escape, or clicking another block) never loses work
	function panEnd() {
		pan_last = null;
		if (!focal_live) return;
		update_attrs({
			focal_x: Math.round(focal_live.x * 10) / 10,
			focal_y: Math.round(focal_live.y * 10) / 10,
		});
		focal_live = null;
	}

	// Inline caption editing (Medium-style): the field appears when the block
	// is selected or already has a caption. Committed on blur/Enter so typing
	// doesn't create an undo step per keystroke.
	const show_caption_editor = $derived(
		editable && !attrs.uploading && (selected || Boolean(attrs.caption)),
	);

	function commitCaption(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value.trim();
		if (value !== attrs.caption) update_attrs({ caption: value });
	}

	// Blurred thumbhash placeholder behind the image until it paints — the
	// hash is stored in the attrs, so the wait shows a soft preview instead
	// of a flat color
	let loaded = $state(false);
	function trackLoad(img: HTMLImageElement) {
		void attrs.src; // re-run when the source swaps
		loaded = img.complete;
		if (img.complete) return;
		const done = () => (loaded = true);
		img.addEventListener('load', done, { once: true });
		return () => img.removeEventListener('load', done);
	}
	const thumb_bg = $derived(
		!loaded && attrs.thumbhash && !attrs.uploading
			? `url(${decodeThumbHash(attrs.thumbhash)})`
			: undefined,
	);

	// Read-only: clicking the image opens the Gallery lightbox (headless mode)
	// with a zoom animation from the image itself.
	let lightbox = $state<{ open: (index: number, from?: HTMLElement) => void } | null>(
		null,
	);
	let img_el = $state<HTMLElement | undefined>(undefined);

	const lightbox_items = $derived(
		!editable && attrs.src
			? [
					{
						id: attrs.image_id ?? attrs.src,
						src: attrs.srcset || attrs.src,
						width: attrs.width ?? undefined,
						height: attrs.height ?? undefined,
						alt: attrs.alt,
						caption: attrs.caption || undefined,
						thumbhash: attrs.thumbhash ?? undefined,
					},
				]
			: [],
	);
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && repositioning) {
			event.preventDefault();
			repositioning = false;
			focal_live = null;
		}
	}} />

<figure class="image" style:aspect-ratio={attrs.caption ? undefined : effective_ratio}>
	{#if attrs.upload_error}
		<div class="error" contenteditable="false">
			<span>Upload failed{upload?.error ? `: ${upload.error}` : ''}</span>
			<Button dense transparent error size="0" onclick={() => delete_node()}>
				Remove
			</Button>
		</div>
	{:else if attrs.src && !editable}
		<button
			type="button"
			class="zoom"
			aria-label={attrs.alt ? `View image: ${attrs.alt}` : 'View image'}
			onclick={() => lightbox?.open(0, img_el)}>
			<img
				src={attrs.src}
				srcset={attrs.srcset || undefined}
				alt={attrs.alt}
				width={attrs.width || undefined}
				height={attrs.height || undefined}
				class:cover={cropped}
				style:aspect-ratio={cropped ? attrs.crop_aspect : undefined}
				style:object-position={cropped ? focal : undefined}
				style:background-color={attrs.background_color || undefined}
				style:background-image={thumb_bg}
				draggable="false"
				data-resize-anchor
				bind:this={img_el}
				{@attach trackLoad} />
		</button>
		<Gallery display="lightbox" items={lightbox_items} bind:this={lightbox} />
	{:else if attrs.src || attrs.blob_url}
		<!-- One element for both the blob preview and the uploaded src:
		     swapping src in place keeps the previous bitmap on screen until
		     the new one decodes, so the placeholder→final transition never
		     flashes empty. -->
		{@const uploading = attrs.uploading && Boolean(attrs.blob_url)}
		<img
			src={uploading ? attrs.blob_url : attrs.src}
			srcset={uploading ? undefined : attrs.srcset || undefined}
			alt={attrs.alt}
			width={attrs.width || undefined}
			height={attrs.height || undefined}
			class:uploading
			class:cover={cropped}
			style:aspect-ratio={cropped ? attrs.crop_aspect : undefined}
			style:object-position={cropped ? focal : undefined}
			style:background-color={attrs.background_color || undefined}
			style:background-image={thumb_bg}
			draggable="false"
			data-resize-anchor
			{@attach trackLoad} />
		{#if repositioning && cropped}
			<!-- Bare drag surface — all controls live in the block's mode toolbar -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="reposition"
				contenteditable="false"
				bind:this={reposition_el}
				onpointerdown={panStart}
				onpointermove={panMove}
				onpointerup={panEnd}
				onpointercancel={panEnd}>
			</div>
		{/if}
		{#if uploading}
			<div class="progress" contenteditable="false" aria-label="Uploading">
				<span class="ring" style:--sweep="{Math.round(progress * 360)}deg"></span>
			</div>
		{/if}
	{/if}
	{#if show_caption_editor}
		<figcaption contenteditable="false">
			<input
				class="caption-input"
				type="text"
				placeholder="Add a caption…"
				value={attrs.caption}
				onchange={commitCaption}
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						commitCaption(event);
						(event.currentTarget as HTMLInputElement).blur();
						editor.focus();
					}
					event.stopPropagation();
				}} />
		</figcaption>
	{:else if attrs.caption && !attrs.uploading}
		<figcaption>{attrs.caption}</figcaption>
	{/if}
</figure>

<style>
	.image {
		position: relative;
		margin: 0;

		img {
			display: block;
			inline-size: 100%;
			block-size: auto;
			border-radius: var(--radius, 8px);
			background-size: cover;
			background-position: center;

			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius, 8px) * var(--squircle-ratio, 2));
			}
		}

		img.uploading {
			filter: blur(1px) brightness(0.85);
		}

		img.cover {
			block-size: auto;
			object-fit: cover;
		}
	}

	.reposition {
		position: absolute;
		inset: 0;
		cursor: move;
		border-radius: var(--radius, 8px);
		/* Vignette: the edges dim so the focus point reads as a spotlight */
		box-shadow: inset 0 0 0 2px var(--action, var(--color-primary));
		background: radial-gradient(
			ellipse at center,
			transparent 40%,
			rgb(0 0 0 / 45%) 100%
		);
		user-select: none;
		touch-action: none;
	}

	.zoom {
		display: block;
		inline-size: 100%;
		padding: 0;
		border: none;
		background: none;
		cursor: zoom-in;
		border-radius: var(--radius, 8px);

		&:focus-visible {
			outline: 2px solid var(--action, var(--color-primary));
			outline-offset: 2px;
		}
	}

	.progress {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	/* Without registration a custom property isn't interpolable and the
	   ring's `transition: --sweep` silently does nothing */
	@property --sweep {
		syntax: '<angle>';
		inherits: false;
		initial-value: 0deg;
	}

	.ring {
		inline-size: 3rem;
		block-size: 3rem;
		border-radius: 50%;
		background: conic-gradient(
			white var(--sweep, 0deg),
			rgb(255 255 255 / 25%) var(--sweep, 0deg)
		);
		mask: radial-gradient(
			farthest-side,
			transparent calc(100% - 5px),
			black calc(100% - 4px)
		);
		filter: drop-shadow(0 1px 4px rgb(0 0 0 / 40%));
		transition: --sweep 200ms ease;
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
		color: var(--color-text);
		font-size: 0.875rem;
	}

	figcaption {
		margin-block-start: 0.5em;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		text-align: center;
	}

	.caption-input {
		inline-size: 100%;
		border: none;
		background: none;
		font: inherit;
		color: inherit;
		text-align: center;
		outline: none;
		padding: 0;

		/* outline: none needs a replacement for keyboard focus */
		&:focus-visible {
			box-shadow: 0 2px 0 var(--action, var(--color-primary));
		}

		&::placeholder {
			color: var(
				--color-text-disabled,
				color-mix(in oklab, currentColor 40%, transparent)
			);
		}
	}
</style>
