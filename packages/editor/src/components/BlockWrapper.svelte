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
	const show_chrome = $derived(
		props.editable && (deletable || has_settings || chrome_actions.length > 0),
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
		snaps: Required<SnapPoint>[];
		engaged: Required<SnapPoint> | null;
		width: number;
	}

	let drag = $state<DragState | null>(null);

	/** Committed width as a CSS value (when not dragging) */
	const committed_width = $derived.by(() => {
		if (!resize) return undefined;
		const value = props.attrs[resize.attr];
		if (typeof value !== 'number') return undefined;
		return (resize.unit ?? 'percent') === 'percent' ? `${value}%` : `${value}px`;
	});

	function defaultSnaps(container_width: number): Required<SnapPoint>[] {
		return [
			{ value: container_width / 3, label: '⅓' },
			{ value: container_width / 2, label: '½' },
			{ value: (container_width * 2) / 3, label: '⅔' },
			{ value: container_width, label: 'full' },
		].map(normalizeSnap);
	}

	function normalizeSnap(snap: SnapPoint): Required<SnapPoint> {
		return {
			value: snap.value,
			label: snap.label ?? '',
			engage_radius: snap.engage_radius ?? 60,
			escape_radius: snap.escape_radius ?? 100,
		};
	}

	function startResize(event: PointerEvent, side: 1 | -1) {
		if (!resize || !wrapper_el) return;
		event.preventDefault();
		event.stopPropagation();
		const container_width =
			wrapper_el.parentElement?.clientWidth ?? wrapper_el.clientWidth;
		const snaps = resize.snap_points
			? resize.snap_points({ container_width, editor: props.editor }).map(normalizeSnap)
			: defaultSnaps(container_width);
		drag = {
			side,
			start_x: event.clientX,
			start_width: wrapper_el.clientWidth,
			container_width,
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
		const max = Math.min(resize.max ?? Infinity, drag.container_width);
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

	function endResize() {
		if (!drag || !resize) return;
		const final = drag.engaged ? drag.engaged.value : drag.width;
		const unit = resize.unit ?? 'percent';
		const value =
			unit === 'percent'
				? Math.round((final / drag.container_width) * 1000) / 10
				: Math.round(final);
		drag = null;
		props.update_attrs({
			[resize.attr]: unit === 'percent' ? Math.min(value, 100) : value,
		});
	}
</script>

<div
	class="wrapper"
	class:selected={props.selected}
	class:resizing={Boolean(drag)}
	role="presentation"
	style:width={drag ? `${drag.width}px` : committed_width}
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
		<div class="chrome" contenteditable="false" bind:this={chrome_el}>
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
		</div>
	{/if}

	{#if resizable}
		<div
			class="grips"
			contenteditable="false"
			style:inset-block-start={grip_area ? `${grip_area.top}px` : undefined}
			style:block-size={grip_area ? `${grip_area.height}px` : undefined}>
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
			{#if drag?.engaged?.label}
				<span class="snap-badge">{drag.engaged.label}</span>
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

		&.selected {
			outline: 2px solid var(--action, var(--color-primary));
			outline-offset: 2px;
		}

		&:hover .chrome,
		&.selected .chrome,
		&:focus-within .chrome {
			opacity: 1;
			pointer-events: auto;
		}

		&:hover .grip,
		&.selected .grip,
		&.resizing .grip {
			opacity: 1;
		}

		&.resizing {
			user-select: none;
		}
	}

	.chrome {
		position: absolute;
		inset-block-start: 0.375rem;
		inset-inline-end: 0.375rem;
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--color-surface, Canvas);
		border: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
		border-radius: var(--radius, 8px);
		box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
		color: var(--color-text-muted);
		opacity: 0;
		pointer-events: none;
		transition: opacity 150ms ease;
		z-index: 3;
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
			opacity 150ms ease,
			background-color 300ms ease;
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
			transition: opacity 150ms ease;
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
		animation: ds-editor-badge-in 150ms ease;
		z-index: 4;
	}

	@keyframes -global-ds-editor-badge-in {
		from {
			opacity: 0;
			translate: -50% 4px;
		}
	}
</style>
