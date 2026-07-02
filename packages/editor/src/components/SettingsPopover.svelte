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

	interface Props {
		props: BlockViewProps;
		settings: NonNullable<BlockSpec['settings']>;
		anchor: DOMRect | null;
		onclose: () => void;
	}

	let { props, settings, anchor, onclose }: Props = $props();

	let panel = $state<HTMLElement | null>(null);

	const fields = $derived(Array.isArray(settings) ? settings : null);
	const CustomSettings = $derived(
		Array.isArray(settings) ? null : (settings as Component<SettingsProps>),
	);

	const visible_fields = $derived(
		fields?.filter((field) => !field.when || field.when(props.attrs)) ?? [],
	);

	const position = $derived.by(() => {
		const width = panel?.offsetWidth ?? 260;
		const height = panel?.offsetHeight ?? 200;
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
	onpointerdown={(event) => {
		if (panel && event.target instanceof Node && panel.contains(event.target)) return;
		onclose();
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		}
	}} />

<div
	class="settings"
	role="dialog"
	aria-label="Block settings"
	contenteditable="false"
	style:left="{position.left}px"
	style:top="{position.top}px"
	bind:this={panel}
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
		box-shadow:
			0 4px 12px rgb(0 0 0 / 8%),
			0 12px 32px rgb(0 0 0 / 12%);

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
