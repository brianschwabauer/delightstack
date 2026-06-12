<script lang="ts">
	import { Button } from '@delightstack/components/actions';
	import { Code, Expand } from '@delightstack/components/display';
	import { Input, Select } from '@delightstack/components/form';
	import {
		theme,
		TOKENS,
		PRESETS,
		ROUNDNESS_OPTIONS,
		DENSITY_OPTIONS,
		FONT_OPTIONS,
		type RoundnessKey,
		type DensityKey,
		type FontKey,
	} from './theme-store.svelte';

	/**
	 * The theme customizer panel — used by the navbar ThemePicker popover and
	 * embedded inline on the Design Tokens guide. All state lives in
	 * theme-store.svelte.ts so multiple panels on one page stay in sync.
	 *
	 * Primary is the hero control: secondary and neutral derive from it in
	 * tokens.css, so one color re-themes everything. The remaining seeds live
	 * behind the Advanced expand to keep the panel approachable.
	 */
	let { inline = false } = $props();

	let show_advanced = $state(false);

	const ADVANCED_TOKENS = TOKENS.filter((token) => token.key !== 'primary');

	// Resolve the effective token colors once the panel is on screen (the
	// popover mounts its content lazily, so this runs at open).
	$effect(() => {
		theme.refreshDefaults();
	});
</script>

<div class="panel not-content" class:inline>
	<header>
		<h3>Theme</h3>
		<Button
			size="0"
			transparent
			dense
			onclick={() => theme.reset()}
			disabled={!theme.has_overrides}>
			Reset
		</Button>
	</header>
	<p class="hint">
		One color themes everything — the rest of the palette derives from it. Pick a primary
		and the whole site re-themes live. Saved in this browser.
	</p>
	<Input
		type="color"
		label="Primary"
		value={theme.prefs.colors.primary ?? theme.defaults.primary ?? '#000000'}
		oninput={(e: { value: string }) => theme.setColor('primary', e.value)} />
	<div class="presets" role="group" aria-label="Preset themes">
		{#each PRESETS as preset (preset.name)}
			<button
				type="button"
				class="swatch"
				style:--swatch={preset.primary}
				onclick={() => theme.setPreset(preset)}
				aria-label={`${preset.name} preset`}
				title={preset.name}>
			</button>
		{/each}
	</div>
	<div class="options">
		<Select
			label="Corners"
			dense
			size="0"
			options={ROUNDNESS_OPTIONS}
			value={theme.prefs.roundness}
			onchange={(e) => theme.setRoundness(e.value as RoundnessKey)} />
		<Select
			label="Density"
			dense
			size="0"
			options={DENSITY_OPTIONS}
			value={theme.prefs.density}
			onchange={(e) => theme.setDensity(e.value as DensityKey)} />
		<Select
			label="Font"
			dense
			size="0"
			options={FONT_OPTIONS}
			value={theme.prefs.font}
			onchange={(e) => theme.setFont(e.value as FontKey)} />
	</div>
	<button
		type="button"
		class="advanced-toggle"
		aria-expanded={show_advanced}
		onclick={() => (show_advanced = !show_advanced)}>
		<svg
			class="chevron"
			class:open={show_advanced}
			xmlns="http://www.w3.org/2000/svg"
			width="1em"
			height="1em"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true">
			<polyline points="9 18 15 12 9 6" />
		</svg>
		Advanced colors
	</button>
	<Expand show={show_advanced}>
		<div class="advanced">
			<p class="hint">
				Secondary (accent controls) and Neutral (the background tint) derive from Primary
				until overridden. Error, Success, and Warning are fixed hues.
			</p>
			<div class="fields">
				{#each ADVANCED_TOKENS as token (token.key)}
					<Input
						type="color"
						dense
						size="0"
						label={token.label}
						value={theme.prefs.colors[token.key] ??
							theme.defaults[token.key] ??
							'#000000'}
						oninput={(e: { value: string }) => theme.setColor(token.key, e.value)} />
				{/each}
			</div>
		</div>
	</Expand>
	{#if theme.css}
		<p class="hint">Copy these overrides into your app's global CSS:</p>
		<Code code={theme.css} language="css" show_line_numbers={false} wrap />
	{:else}
		<p class="hint">No overrides yet — the pickers show the current defaults.</p>
	{/if}
</div>

<style>
	/* No max-height/overflow here — in the popover, the Popover's own .content
	   scroller handles overflow (its overlay scrollbar hugs the panel edge;
	   an inner scroller would float the scrollbar over the content). */
	.panel {
		display: grid;
		gap: 1rem;
		width: min(22rem, 85vw);

		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 0.5rem;

			h3 {
				margin: 0;
				font-size: var(--text-base);
				font-weight: var(--font-weight-semibold);
			}
		}

		.presets {
			display: flex;
			flex-wrap: wrap;
			justify-content: center;
			gap: 0.625rem;
		}

		.swatch {
			width: 1.75rem;
			height: 1.75rem;
			padding: 0;
			border: 2px solid var(--color-border);
			border-radius: var(--radius-full);
			background: var(--swatch);
			cursor: pointer;
			transition: transform var(--duration-fast) var(--ease-out);

			&:hover {
				transform: scale(1.15);
			}

			&:focus-visible {
				outline: 2px solid var(--color-action);
				outline-offset: 2px;
			}
		}

		.options {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0.875rem 0.625rem;
		}

		.advanced-toggle {
			display: flex;
			align-items: center;
			gap: 0.375rem;
			padding: 0;
			border: none;
			background: none;
			color: var(--color-text-muted);
			font-size: var(--text-sm);
			font-weight: var(--font-weight-medium);
			cursor: pointer;
			transition: color 200ms;

			&:hover {
				color: var(--color-text);
				transition: none;
			}

			.chevron {
				transition: rotate var(--duration-normal) var(--ease-out);

				&.open {
					rotate: 90deg;
				}
			}
		}

		.advanced {
			display: grid;
			gap: 0.875rem;
		}

		.fields {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0.875rem 0.625rem;
		}

		.hint {
			margin: 0;
			font-size: var(--text-sm);
			color: var(--color-text-muted);
		}

		&.inline {
			width: 100%;
			padding: 1.25rem;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			background: var(--color-surface);

			.options {
				grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
			}

			.fields {
				grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
			}
		}
	}
</style>
