<script lang="ts">
	import type { Component } from 'svelte';
	import {
		Button,
		ButtonGroup,
		Input,
		Range,
		Select,
		Toggle,
	} from '@delightstack/components';
	import type { BlockSpec, SettingsField, SettingsProps } from '../types/index.js';
	import type { BlockViewProps } from '../core/node-view/block-props.svelte.js';
	import { portal } from './portal.js';
	import { surfaceIn, surfaceOut } from './motion.js';

	interface Props {
		props: BlockViewProps;
		settings: NonNullable<BlockSpec['settings']>;
		anchor: DOMRect | null;
		onclose: () => void;
	}

	let { props, settings, anchor, onclose }: Props = $props();

	let panel = $state<HTMLElement | null>(null);
	let panel_width = $state(0);
	let panel_height = $state(0);

	// Focus the first field on open; hand focus back where it was on close
	$effect(() => {
		const previous = document.activeElement;
		const target = panel?.querySelector<HTMLElement>(
			'input, select, textarea, button, [tabindex]',
		);
		target?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	});

	/**
	 * True when the event happened inside the panel OR inside a popup the
	 * panel spawned (Select options render in the design system's portal
	 * layer, which is not a DOM descendant of the panel).
	 */
	function withinPanel(event: Event): boolean {
		const target = event.target;
		if (!(target instanceof Node)) return false;
		if (panel?.contains(target)) return true;
		if (!target.isConnected) return true; // re-render detached it mid-dispatch
		return target instanceof Element && Boolean(target.closest('.portals, .portal'));
	}

	const fields = $derived(Array.isArray(settings) ? settings : null);
	const CustomSettings = $derived(
		Array.isArray(settings) ? null : (settings as Component<SettingsProps>),
	);

	const visible_fields = $derived(
		fields?.filter((field) => !field.when || field.when(props.attrs)) ?? [],
	);

	const position = $derived.by(() => {
		const width = panel_width || 260;
		const height = panel_height || 200;
		const viewport_w = typeof window === 'undefined' ? 1200 : window.innerWidth;
		const viewport_h = typeof window === 'undefined' ? 800 : window.innerHeight;
		if (!anchor)
			return { left: viewport_w / 2 - width / 2, top: viewport_h / 2 - height / 2 };
		let top = anchor.bottom + 8;
		if (top + height > viewport_h - 8) top = Math.max(8, anchor.top - height - 8);
		const left = Math.max(8, Math.min(anchor.right - width, viewport_w - width - 8));
		return { left, top };
	});

	function set(field: SettingsField, value: unknown) {
		props.update_attrs({ [field.attr]: value });
	}
</script>

<svelte:window
	onpointerdowncapture={(event) => {
		if (withinPanel(event)) return;
		// Swallow the dismissing click: closing the panel and moving the
		// caret / pressing whatever was underneath in one gesture erodes
		// trust in where the click will land
		event.preventDefault();
		event.stopPropagation();
		onclose();
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape' && !event.defaultPrevented) {
			// An open child popup (Select options) handles its own Escape and
			// preventDefaults it — only the innermost layer closes
			event.preventDefault();
			onclose();
		}
	}}
	onscrollcapture={(event) => {
		// The panel is fixed-position from a snapshot rect; scrolling the
		// page would strand it. Scrolls inside the panel or its popups are
		// fine.
		if (!withinPanel(event)) onclose();
	}}
	onresize={() => onclose()} />

<div
	class="settings"
	in:surfaceIn={{
		origin: anchor && position.top < anchor.top ? 'bottom right' : 'top right',
	}}
	out:surfaceOut
	role="dialog"
	aria-modal="true"
	aria-label="Block settings"
	contenteditable="false"
	style:left="{position.left}px"
	style:top="{position.top}px"
	style:visibility={panel_height ? null : 'hidden'}
	bind:this={panel}
	bind:offsetWidth={panel_width}
	bind:offsetHeight={panel_height}
	use:portal>
	{#if CustomSettings}
		<CustomSettings
			attrs={props.attrs}
			editor={props.editor}
			update_attrs={props.update_attrs} />
	{:else}
		{#each visible_fields as field (field.attr)}
			{#if field.control === 'text'}
				<Input
					dense
					size="0"
					label={field.label}
					label_display="pinned"
					value={String(props.attrs[field.attr] ?? '')}
					oninput={({ value }) => set(field, String(value ?? ''))} />
			{:else if field.control === 'textarea'}
				<Input
					dense
					size="0"
					type="textarea"
					rows={3}
					label={field.label}
					label_display="pinned"
					value={String(props.attrs[field.attr] ?? '')}
					oninput={({ value }) => set(field, String(value ?? ''))} />
			{:else if field.control === 'select'}
				<Select
					dense
					size="0"
					label={field.label}
					value={props.attrs[field.attr]}
					options={field.options ?? []}
					onchange={({ value }) => set(field, value)} />
			{:else if field.control === 'toggle'}
				<div class="toggle-row">
					<span class="toggle-label">{field.label}</span>
					<Toggle
						dense
						size="0"
						checked={Boolean(props.attrs[field.attr])}
						onchange={({ checked }) => set(field, Boolean(checked))} />
				</div>
			{:else if field.control === 'range'}
				<Range
					dense
					size="0"
					label={field.label}
					show_value
					min={field.min ?? 0}
					max={field.max ?? 100}
					step={field.step ?? 1}
					value={Number(props.attrs[field.attr] ?? field.min ?? 0)}
					oninput={({ value }) => set(field, Number(value))}
					onchange={({ value }) => set(field, Number(value))} />
			{:else if field.control === 'segmented'}
				<div class="field">
					<span class="label">{field.label}</span>
					<ButtonGroup size="0" attached>
						{#each field.options ?? [] as option (option.label)}
							<Button
								dense
								full_width
								active={option.value === props.attrs[field.attr]}
								onclick={() => set(field, option.value)}>
								{option.label}
							</Button>
						{/each}
					</ButtonGroup>
				</div>
			{/if}
		{/each}
	{/if}
</div>

<style>
	.settings {
		position: fixed;
		z-index: 60;
		min-width: 16rem;
		max-width: 22rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem;
		background: var(--color-surface, Canvas);
		border: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
		border-radius: min(var(--radius-lg, 12px), var(--radius-cap, 40px));
		box-shadow: var(
			--shadow-lg,
			0 4px 12px rgb(0 0 0 / 8%),
			0 12px 32px rgb(0 0 0 / 12%)
		);

		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: min(
				calc(var(--radius-lg, 12px) * var(--squircle-ratio, 2)),
				calc(var(--radius-cap, 40px) * var(--squircle-ratio, 2))
			);
		}
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.label,
	.toggle-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}
</style>
