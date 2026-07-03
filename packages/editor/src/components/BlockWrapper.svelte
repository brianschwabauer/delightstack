<script lang="ts">
	import { Button } from '@delightstack/components';
	import type { BlockSpec, InteractiveOptions, SnapPoint } from '../types/index.js';
	import type { BlockViewProps } from '../core/node-view/block-props.svelte.js';
	import { icons } from '../core/icons.js';
	import SettingsPopover from './SettingsPopover.svelte';

	interface Props {
		props: BlockViewProps;
		spec: BlockSpec;
		interactive: InteractiveOptions;
	}

	let { props, spec, interactive }: Props = $props();

	let wrapper_el = $state<HTMLElement | null>(null);
	let chrome_el = $state<HTMLElement | null>(null);
	let settings_anchor = $state<DOMRect | null>(null);

	const deletable = $derived(interactive.deletable !== false && props.editable);
	const has_settings = $derived(Boolean(spec.settings) && props.editable);

	// Context handed to the block's chrome actions (hover-bubble buttons)
	const action_ctx = $derived({
		attrs: props.attrs,
		editor: props.editor,
		pos: props.pos,
		update_attrs: props.update_attrs,
		ui: props.ui,
	});
	const chrome_actions = $derived(
		(spec.chrome ?? []).filter((action) => !action.when || action.when(action_ctx)),
	);
	// An active chrome mode (ui.chrome_mode set by the block) swaps the whole
	// toolbar for the mode's actions + an exit button
	const active_mode = $derived(
		(spec.chrome_modes ?? []).find((mode) => mode.name === props.ui.chrome_mode) ?? null,
	);
	const mode_actions = $derived(
		(active_mode?.actions ?? []).filter(
			(action) => !action.when || action.when(action_ctx),
		),
	);
	const mode_status = $derived(active_mode?.status?.(action_ctx) ?? null);
	const show_chrome = $derived(
		props.editable &&
			(deletable || has_settings || chrome_actions.length > 0 || Boolean(active_mode)),
	);

	const Component = $derived(spec.component!);

	function openSettings() {
		settings_anchor = chrome_el?.getBoundingClientRect() ?? null;
		props.settings_open = true;
	}

	$effect(() => {
		if (props.settings_open && !settings_anchor) {
			settings_anchor = chrome_el?.getBoundingClientRect() ?? null;
		}
		if (!props.settings_open) settings_anchor = null;
	});

	function select(event: PointerEvent) {
		if (interactive.selectable === false || !props.editable) return;
		// Only promote to a NodeSelection for clicks on the block chrome/body,
		// not inside editable content
		if (event.target instanceof Node && isInsideContent(event.target)) return;
		const pos = props.pos();
		if (pos !== undefined) props.editor.selectNode(pos);
	}

	function isInsideContent(target: Node): boolean {
		let el: Node | null = target;
		while (el) {
			if (el instanceof HTMLElement && el.hasAttribute('data-editor-content'))
				return true;
			el = el.parentNode;
		}
		return false;
	}

	// ---- magnetic snap resize ----

	const resize = $derived(interactive.resize);
	const resizable = $derived(Boolean(resize) && props.editable);
	const breakout = $derived(Boolean(resize?.breakout));
	const width_mode = $derived.by((): 'normal' | 'wide' | 'full' => {
		if (!breakout) return 'normal';
		const mode = props.attrs.width_mode;
		return mode === 'wide' || mode === 'full' ? mode : 'normal';
	});

	const WIDTH_MODES = [
		{ value: 'normal', label: 'Text width', icon: icons.width_text },
		{ value: 'wide', label: 'Wide', icon: icons.width_wide },
		{ value: 'full', label: 'Full width', icon: icons.width_full },
	] as const;

	function setWidthMode(mode: 'normal' | 'wide' | 'full') {
		if (!resize) return;
		props.update_attrs(
			mode === 'normal'
				? { width_mode: mode, [resize.attr]: null }
				: { width_mode: mode },
		);
	}

	/**
	 * Resolve the wide/full breakout widths by measuring a probe element —
	 * the CSS tokens can hold arbitrary min()/calc() expressions the host
	 * overrides, so they can't be parsed, only rendered.
	 */
	function measureBreakoutWidths(host: HTMLElement): { wide: number; full: number } {
		const probe = document.createElement('div');
		probe.style.cssText = 'position: absolute; visibility: hidden; pointer-events: none;';
		host.appendChild(probe);
		probe.style.width = 'var(--editor-wide-width, min(1100px, calc(100vw - 2rem)))';
		const wide = probe.offsetWidth;
		probe.style.width = 'var(--editor-full-width, 100vw)';
		const full = probe.offsetWidth;
		probe.remove();
		return { wide, full };
	}

	// The grips center on the media itself (image/video/iframe), not the whole
	// wrapper — a caption below the media would otherwise pull them off-center.
	let grip_area = $state<{ top: number; height: number } | null>(null);

	$effect(() => {
		const wrapper = wrapper_el;
		if (!resizable || !wrapper) {
			grip_area = null;
			return;
		}
		const findAnchor = () =>
			wrapper.querySelector('[data-resize-anchor]') ??
			wrapper.querySelector('img, video, iframe');
		const measure = () => {
			const anchor = findAnchor();
			if (!(anchor instanceof HTMLElement) || !anchor.offsetHeight) {
				grip_area = null;
				return;
			}
			const wrapper_rect = wrapper.getBoundingClientRect();
			const anchor_rect = anchor.getBoundingClientRect();
			grip_area = { top: anchor_rect.top - wrapper_rect.top, height: anchor_rect.height };
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(wrapper);
		const anchor = findAnchor();
		if (anchor instanceof HTMLElement) observer.observe(anchor);
		return () => observer.disconnect();
	});

	interface DragState {
		side: 1 | -1;
		start_x: number;
		start_width: number;
		container_width: number;
		wide_width: number;
		full_width: number;
		snaps: Required<SnapPoint>[];
		engaged: Required<SnapPoint> | null;
		width: number;
	}

	let drag = $state<DragState | null>(null);
	/** Spring-settles the width from the drag px to the committed value */
	let snapping = $state(false);
	let snapping_timeout: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(snapping_timeout));

	/** Committed width as a CSS value (when not dragging) */
	const committed_width = $derived.by(() => {
		if (!resize) return undefined;
		// Breakout tiers size themselves from the data-width-mode CSS
		if (width_mode !== 'normal') return undefined;
		const value = props.attrs[resize.attr];
		if (typeof value !== 'number') return undefined;
		return (resize.unit ?? 'percent') === 'percent' ? `${value}%` : `${value}px`;
	});

	function defaultSnaps(
		container_width: number,
		wide_width: number,
		full_width: number,
	): Required<SnapPoint>[] {
		const snaps: SnapPoint[] = [
			{ value: container_width / 3, label: '⅓' },
			{ value: container_width / 2, label: '½' },
			{ value: (container_width * 2) / 3, label: '⅔' },
			{ value: container_width, label: breakout ? 'text' : 'full' },
		];
		if (breakout) {
			if (wide_width > container_width + 40) {
				snaps.push({ value: wide_width, label: 'wide', mode: 'wide' });
			}
			if (full_width > Math.max(wide_width, container_width) + 40) {
				snaps.push({ value: full_width, label: 'full', mode: 'full' });
			}
		}
		return snaps.map(normalizeSnap);
	}

	function normalizeSnap(snap: SnapPoint): Required<SnapPoint> {
		return {
			value: snap.value,
			label: snap.label ?? '',
			engage_radius: snap.engage_radius ?? 60,
			escape_radius: snap.escape_radius ?? 100,
			mode: snap.mode ?? 'normal',
		};
	}

	function startResize(event: PointerEvent, side: 1 | -1) {
		if (!resize || !wrapper_el) return;
		event.preventDefault();
		event.stopPropagation();
		const container_width =
			wrapper_el.parentElement?.clientWidth ?? wrapper_el.clientWidth;
		const { wide, full } = breakout
			? measureBreakoutWidths(wrapper_el)
			: { wide: container_width, full: container_width };
		const snaps = resize.snap_points
			? resize.snap_points({ container_width, editor: props.editor }).map(normalizeSnap)
			: defaultSnaps(container_width, wide, full);
		clearTimeout(snapping_timeout);
		snapping = false;
		drag = {
			side,
			start_x: event.clientX,
			start_width: wrapper_el.clientWidth,
			container_width,
			wide_width: wide,
			full_width: full,
			snaps,
			engaged: null,
			width: wrapper_el.clientWidth,
		};
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
	}

	function moveResize(event: PointerEvent) {
		if (!drag || !resize) return;
		// Both grips resize symmetrically around the center (2x horizontal delta)
		const delta = (event.clientX - drag.start_x) * drag.side * 2;
		const min = resize.min ?? 120;
		const limit = breakout
			? Math.max(drag.full_width, drag.container_width)
			: drag.container_width;
		const max = Math.min(resize.max ?? Infinity, limit);
		const raw = Math.max(min, Math.min(drag.start_width + delta, max));

		// Hysteresis: stay engaged until the pointer escapes; engage the
		// nearest point within its engage radius otherwise
		let engaged = drag.engaged;
		if (engaged && Math.abs(raw - engaged.value) > engaged.escape_radius) engaged = null;
		if (!engaged) {
			engaged =
				drag.snaps.find((snap) => Math.abs(raw - snap.value) <= snap.engage_radius) ??
				null;
		}

		// Gravity easing: rubber-band the displayed width toward the engaged
		// snap so the magnet feels physical instead of jumpy
		const width = engaged ? engaged.value + (raw - engaged.value) * 0.2 : raw;
		drag = { ...drag, engaged, width };
	}

	// ---- bottom crop handle (shortens media height; cover + focal point) ----

	const crop = $derived(interactive.crop);
	const croppable = $derived.by(() => {
		if (!crop || !props.editable) return false;
		return crop.natural(props.attrs) !== null;
	});
	const CROP_EPSILON = 0.005;

	interface CropDrag {
		start_y: number;
		start_height: number;
		width: number;
		natural: number;
		height: number;
	}
	let crop_drag = $state<CropDrag | null>(null);

	function startCrop(event: PointerEvent) {
		if (!crop || !wrapper_el) return;
		const natural = crop.natural(props.attrs);
		if (!natural) return;
		event.preventDefault();
		event.stopPropagation();
		const width = wrapper_el.clientWidth;
		const start_height = grip_area?.height ?? wrapper_el.clientHeight;
		crop_drag = {
			start_y: event.clientY,
			start_height,
			width,
			natural,
			height: start_height,
		};
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
	}

	function moveCrop(event: PointerEvent) {
		if (!crop_drag || !crop) return;
		const min = crop.min_height ?? 80;
		const natural_height = crop_drag.width / crop_drag.natural;
		crop_drag.height = Math.max(
			min,
			Math.min(
				crop_drag.start_height + (event.clientY - crop_drag.start_y),
				natural_height,
			),
		);
	}

	function endCrop() {
		if (!crop_drag || !crop) return;
		const aspect = crop_drag.width / crop_drag.height;
		const natural = crop_drag.natural;
		crop_drag = null;
		// Releasing at (or within a hair of) the natural height clears the
		// crop entirely — and resets the focal point with it
		if (Math.abs(aspect - natural) / natural <= CROP_EPSILON || aspect <= natural) {
			props.update_attrs({ [crop.aspect_attr]: null, ...(crop.reset ?? {}) });
		} else {
			props.update_attrs({ [crop.aspect_attr]: Math.round(aspect * 10000) / 10000 });
		}
	}

	function endResize() {
		if (!drag || !resize) return;
		const final = drag.engaged ? drag.engaged.value : drag.width;
		const unit = resize.unit ?? 'percent';

		// Which tier does this width land in? Snaps carry their mode; a free
		// release past the column picks the nearest tier by midpoints.
		let mode: 'normal' | 'wide' | 'full' = 'normal';
		if (breakout) {
			if (drag.engaged) {
				mode = drag.engaged.mode;
			} else if (final > drag.container_width) {
				const wide_mid = (drag.container_width + drag.wide_width) / 2;
				const full_mid = (drag.wide_width + drag.full_width) / 2;
				mode = final <= wide_mid ? 'normal' : final <= full_mid ? 'wide' : 'full';
			}
		}

		const value =
			unit === 'percent'
				? Math.min(Math.round((final / drag.container_width) * 1000) / 10, 100)
				: Math.round(final);
		drag = null;

		// Let the width spring from the drag px to the committed value
		snapping = true;
		clearTimeout(snapping_timeout);
		snapping_timeout = setTimeout(() => (snapping = false), 360);

		if (breakout) {
			props.update_attrs(
				mode === 'normal'
					? { width_mode: 'normal', [resize.attr]: value }
					: { width_mode: mode },
			);
		} else {
			props.update_attrs({ [resize.attr]: value });
		}
	}
</script>

<div
	class="wrapper"
	class:selected={props.selected}
	class:resizing={Boolean(drag)}
	class:breakout
	class:snapping
	class:crop-dragging={Boolean(crop_drag)}
	data-width-mode={breakout && !drag ? width_mode : undefined}
	role="presentation"
	style:width={drag ? `${drag.width}px` : committed_width}
	style:--crop-aspect={crop_drag ? crop_drag.width / crop_drag.height : undefined}
	onpointerdown={select}
	bind:this={wrapper_el}>
	<Component
		attrs={props.attrs}
		selected={props.selected}
		editable={props.editable}
		editor={props.editor}
		pos={props.pos}
		update_attrs={props.update_attrs}
		delete_node={props.delete_node}
		open_settings={openSettings}
		content={props.content}
		ui={props.ui} />

	{#if show_chrome}
		<div
			class="chrome"
			class:mode-active={Boolean(active_mode)}
			contenteditable="false"
			bind:this={chrome_el}>
			{#if active_mode}
				{#if active_mode.hint}
					<span class="mode-hint">{active_mode.hint}</span>
				{/if}
				{#each mode_actions as action (action.name)}
					<Button
						icon
						transparent
						size="0"
						dense
						active={action.is_active?.(action_ctx) ?? false}
						aria-label={action.label}
						tooltip={action.label}
						onpointerdown={(event: PointerEvent) => {
							event.preventDefault();
							event.stopPropagation();
							action.run(action_ctx);
						}}>
						{@html action.icon}
					</Button>
				{/each}
				{#if mode_status}
					<span class="mode-status">{mode_status}</span>
				{/if}
				<span class="mode-divider"></span>
				<Button
					icon
					transparent
					size="0"
					dense
					aria-label="Done"
					tooltip="Done"
					onpointerdown={(event: PointerEvent) => {
						event.preventDefault();
						event.stopPropagation();
						active_mode?.exit(action_ctx);
					}}>
					{@html icons.check}
				</Button>
			{:else}
				{#if resizable && breakout}
					{#each WIDTH_MODES as entry (entry.value)}
						<Button
							icon
							transparent
							size="0"
							dense
							active={width_mode === entry.value}
							aria-label={entry.label}
							tooltip={entry.label}
							onpointerdown={(event: PointerEvent) => {
								if (event.button !== 0) return;
								event.preventDefault();
								event.stopPropagation();
								setWidthMode(entry.value);
							}}>
							{@html entry.icon}
						</Button>
					{/each}
				{/if}
				{#each chrome_actions as action (action.name)}
					<Button
						icon
						transparent
						size="0"
						dense
						active={action.is_active?.(action_ctx) ?? false}
						aria-label={action.label}
						tooltip={action.label}
						onpointerdown={(event: PointerEvent) => {
							event.preventDefault();
							event.stopPropagation();
							action.run(action_ctx);
						}}>
						{@html action.icon}
					</Button>
				{/each}
				{#if has_settings}
					<Button
						icon
						transparent
						size="0"
						dense
						aria-label="Block settings"
						tooltip="Settings"
						onpointerdown={(event: PointerEvent) => {
							event.preventDefault();
							event.stopPropagation();
							if (props.settings_open) props.settings_open = false;
							else openSettings();
						}}>
						{@html icons.settings}
					</Button>
				{/if}
				{#if deletable}
					<Button
						icon
						transparent
						size="0"
						dense
						aria-label="Delete block"
						tooltip="Delete"
						onpointerdown={(event: PointerEvent) => {
							event.preventDefault();
							event.stopPropagation();
							props.delete_node();
						}}>
						{@html icons.trash}
					</Button>
				{/if}
			{/if}
		</div>
	{/if}

	{#if resizable || croppable}
		<div
			class="grips"
			contenteditable="false"
			style:inset-block-start={grip_area ? `${grip_area.top}px` : undefined}
			style:block-size={crop_drag
				? `${crop_drag.height}px`
				: grip_area
					? `${grip_area.height}px`
					: undefined}>
			{#if resizable}
				{#each [-1, 1] as side (side)}
					<button
						type="button"
						class="grip"
						class:start={side === -1}
						class:end={side === 1}
						aria-label="Resize"
						onpointerdown={(event) => startResize(event, side as 1 | -1)}
						onpointermove={moveResize}
						onpointerup={endResize}
						onpointercancel={endResize}>
					</button>
				{/each}
			{/if}
			{#if drag?.engaged?.label}
				<span class="snap-badge">{drag.engaged.label}</span>
			{/if}
			{#if croppable}
				<button
					type="button"
					class="grip crop-grip"
					aria-label="Crop height"
					onpointerdown={startCrop}
					onpointermove={moveCrop}
					onpointerup={endCrop}
					onpointercancel={endCrop}>
				</button>
			{/if}
		</div>
	{/if}
</div>

{#if props.settings_open && spec.settings}
	<SettingsPopover
		{props}
		settings={spec.settings}
		anchor={settings_anchor}
		onclose={() => (props.settings_open = false)} />
{/if}

<style>
	.wrapper {
		position: relative;
		border-radius: var(--radius, 8px);
		margin-inline: auto;
		/* Transparent at rest so selection eases out; snap-in below */
		outline: 2px solid transparent;
		outline-offset: 2px;
		transition: outline-color var(--duration-normal, 200ms) var(--ease-out, ease);

		&.selected {
			outline-color: var(--action, var(--color-primary));
			transition: outline-color 80ms var(--ease-out, ease);
		}

		&:hover .chrome,
		&.selected .chrome,
		&:focus-within .chrome {
			opacity: 1;
			pointer-events: auto;
			/* Snap in (the base rule still eases the fade out) */
			transition: none;
		}

		&:hover .grip,
		&.selected .grip,
		&.resizing .grip,
		&:focus-within .grip {
			opacity: 1;
		}

		&.resizing,
		&.crop-dragging {
			user-select: none;
		}

		/* Live crop preview: the media element (marked data-resize-anchor)
		   tracks the dragged aspect and covers its shrinking box */
		&.crop-dragging :global([data-resize-anchor]) {
			aspect-ratio: var(--crop-aspect);
			block-size: auto;
			object-fit: cover;
		}

		/* Breakout tiers center on the column's own midline (margin-left 50%
		   + self-translate). On a viewport-centered page that reaches the
		   screen edges; hosts override --editor-wide-width /
		   --editor-full-width (e.g. to 100%) and the same math degrades to
		   plain in-column centering. */
		&[data-width-mode='wide'] {
			width: var(--editor-wide-width, min(1100px, calc(100vw - 2rem)));
			max-width: var(--editor-wide-width, calc(100vw - 2rem));
			margin-left: 50%;
			translate: -50% 0;
		}

		&[data-width-mode='full'] {
			width: var(--editor-full-width, 100vw);
			max-width: var(--editor-full-width, 100vw);
			margin-left: 50%;
			translate: -50% 0;
		}

		/* During a breakout drag the inline px width takes over; keep the
		   same centering so widths inside and beyond the column are one
		   continuous motion */
		&.breakout.resizing {
			margin-left: 50%;
			translate: -50% 0;
			max-width: none;
		}

		/* Release: the width springs from the drag px to the committed
		   value with a slight overshoot */
		&.snapping {
			transition: width 280ms cubic-bezier(0.34, 1.2, 0.64, 1);
		}
	}

	.chrome {
		position: absolute;
		inset-block-start: 0.375rem;
		inset-inline-end: 0.375rem;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		background: var(--color-surface, Canvas);
		border: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
		border-radius: var(--radius, 8px);
		box-shadow: var(--shadow-md, 0 2px 8px rgb(0 0 0 / 10%));
		color: var(--color-text-muted);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--duration-fast, 150ms) var(--ease-out, ease);
		z-index: 3;

		/* An active mode owns the toolbar: always visible, not hover-gated */
		&.mode-active {
			opacity: 1;
			pointer-events: auto;
		}
	}

	.mode-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		padding-inline: 0.5rem 0.25rem;
		white-space: nowrap;
	}

	.mode-status {
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		padding-inline: 0.25rem;
		white-space: nowrap;
	}

	.mode-divider {
		inline-size: 1px;
		align-self: stretch;
		margin-block: 0.25rem;
		background: var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
	}

	.grips {
		/* Overlays the media element (inline style from the measured
		   grip_area); falls back to covering the whole wrapper */
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.grip {
		position: absolute;
		inset-block: 0;
		margin-block: auto;
		inline-size: 6px;
		block-size: min(50%, 4rem);
		pointer-events: auto;
		padding: 0;
		border: none;
		border-radius: 3px;
		background: color-mix(in oklab, var(--color-text, currentColor) 45%, transparent);
		box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--color-bg, Canvas) 80%, transparent);
		cursor: ew-resize;
		opacity: 0;
		transition:
			opacity var(--duration-fast, 150ms) var(--ease-out, ease),
			background-color var(--duration-fast, 150ms) var(--ease-out, ease);
		touch-action: none;
		z-index: 2;

		&.start {
			inset-inline-start: 5px;
		}

		&.end {
			inset-inline-end: 5px;
		}

		&:hover,
		&:active {
			background: var(--action, var(--color-primary));
			transition: opacity var(--duration-fast, 150ms) var(--ease-out, ease);
		}

		/* A focused grip must be visible even though it rests at opacity 0 */
		&:focus-visible {
			opacity: 1;
			outline: 2px solid var(--action, var(--color-primary));
			outline-offset: 2px;
		}

		/* Bottom crop handle: horizontal pill centered on the media's
		   bottom edge */
		&.crop-grip {
			inset-block: auto;
			inset-block-end: -3px;
			inset-inline: 0;
			margin-inline: auto;
			inline-size: min(50%, 4rem);
			block-size: 6px;
			cursor: ns-resize;
		}
	}

	.snap-badge {
		position: absolute;
		inset-block-start: -1.75rem;
		inset-inline-start: 50%;
		translate: -50% 0;
		font-size: 0.6875rem;
		font-weight: 600;
		padding: 0.125rem 0.5rem;
		border-radius: 1rem;
		background: var(--action, var(--color-primary));
		color: white;
		pointer-events: none;
		animation: ds-editor-badge-in 180ms
			var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
		z-index: 4;
	}

	@keyframes -global-ds-editor-badge-in {
		from {
			opacity: 0;
			scale: 0.8;
			translate: -50% 4px;
		}
	}
</style>
