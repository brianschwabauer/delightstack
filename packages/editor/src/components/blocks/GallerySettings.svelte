<script lang="ts">
	import { Button, ButtonGroup, Range } from '@delightstack/components';
	import type { SettingsProps } from '../../types/index.js';

	type GalleryDisplay =
		| 'grid'
		| 'masonry'
		| 'masonry-row'
		| 'slider'
		| 'slideshow'
		| 'list';

	let { attrs, update_attrs }: SettingsProps = $props();

	const LAYOUTS: { value: GalleryDisplay; label: string }[] = [
		{ value: 'grid', label: 'Grid' },
		{ value: 'masonry', label: 'Masonry' },
		{ value: 'masonry-row', label: 'Masonry rows' },
		{ value: 'slider', label: 'Slider' },
		{ value: 'slideshow', label: 'Slideshow' },
		{ value: 'list', label: 'List' },
	];
	const SIZE_LABELS = ['S', 'M', 'L', 'XL'];
	const STEP_LABELS = ['None', 'S', 'M', 'L'];

	function setScale(key: 'size' | 'spacing' | 'radius', value: number) {
		update_attrs({ [key]: String(value) });
	}
</script>

{#snippet layoutIcon(key: GalleryDisplay)}
	<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
		{#if key === 'grid'}
			<rect x="3" y="3" width="8" height="8" rx="1.5" />
			<rect x="13" y="3" width="8" height="8" rx="1.5" />
			<rect x="3" y="13" width="8" height="8" rx="1.5" />
			<rect x="13" y="13" width="8" height="8" rx="1.5" />
		{:else if key === 'masonry'}
			<rect x="3" y="3" width="8" height="11" rx="1.5" />
			<rect x="3" y="16" width="8" height="5" rx="1.5" />
			<rect x="13" y="3" width="8" height="5" rx="1.5" />
			<rect x="13" y="10" width="8" height="11" rx="1.5" />
		{:else if key === 'masonry-row'}
			<rect x="3" y="3" width="7" height="8" rx="1.5" />
			<rect x="12" y="3" width="9" height="8" rx="1.5" />
			<rect x="3" y="13" width="11" height="8" rx="1.5" />
			<rect x="16" y="13" width="5" height="8" rx="1.5" />
		{:else if key === 'slider'}
			<rect x="6" y="5" width="12" height="14" rx="1.5" />
			<path d="M3 8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
			<path d="M21 8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		{:else if key === 'slideshow'}
			<rect x="3" y="4" width="18" height="13" rx="1.5" />
			<polygon points="10 8 15 10.5 10 13" fill="var(--color-surface, #fff)" />
			<circle cx="9" cy="20" r="1" />
			<circle cx="12" cy="20" r="1" />
			<circle cx="15" cy="20" r="1" />
		{:else if key === 'list'}
			<rect x="3" y="3" width="6" height="5" rx="1.5" />
			<path
				d="M12 4.5h9M12 7h6"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round" />
			<rect x="3" y="10" width="6" height="5" rx="1.5" />
			<path
				d="M12 11.5h9M12 14h6"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round" />
			<rect x="3" y="17" width="6" height="5" rx="1.5" />
			<path
				d="M12 18.5h9M12 21h6"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round" />
		{/if}
	</svg>
{/snippet}

<div class="settings">
	<div class="field">
		<span class="label">Layout</span>
		<ButtonGroup size="0">
			{#each LAYOUTS as layout (layout.value)}
				<Button
					icon
					size="0"
					translucent
					active={attrs.display === layout.value}
					accent={attrs.display === layout.value}
					tooltip={layout.label}
					aria-label={layout.label}
					onclick={() => update_attrs({ display: layout.value })}>
					{@render layoutIcon(layout.value)}
				</Button>
			{/each}
		</ButtonGroup>
	</div>

	<div class="field">
		<span class="label">Fit</span>
		<ButtonGroup size="0">
			<Button
				size="0"
				translucent
				active={attrs.fit !== 'cover'}
				accent={attrs.fit !== 'cover'}
				tooltip="Show the whole image"
				onclick={() => update_attrs({ fit: 'contain' })}>
				Fit
			</Button>
			<Button
				size="0"
				translucent
				active={attrs.fit === 'cover'}
				accent={attrs.fit === 'cover'}
				tooltip="Fill the frame (cropped)"
				onclick={() => update_attrs({ fit: 'cover' })}>
				Fill
			</Button>
		</ButtonGroup>
	</div>

	<div class="field">
		<span class="label">Thumbnail size</span>
		<Range
			min={0}
			max={3}
			step={1}
			value={Number(attrs.size) || 0}
			show_ticks
			tick_labels={SIZE_LABELS}
			aria_label="Thumbnail size"
			onchange={({ value }) => setScale('size', value as number)} />
	</div>
	<div class="field">
		<span class="label">Spacing</span>
		<Range
			min={0}
			max={3}
			step={1}
			value={Number(attrs.spacing) || 0}
			show_ticks
			tick_labels={STEP_LABELS}
			aria_label="Spacing"
			onchange={({ value }) => setScale('spacing', value as number)} />
	</div>
	<div class="field">
		<span class="label">Corners</span>
		<Range
			min={0}
			max={3}
			step={1}
			value={Number(attrs.radius) || 0}
			show_ticks
			tick_labels={STEP_LABELS}
			aria_label="Corner radius"
			onchange={({ value }) => setScale('radius', value as number)} />
	</div>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}
</style>
