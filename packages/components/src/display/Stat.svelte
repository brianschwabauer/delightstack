<script lang="ts">
	import type { Component } from 'svelte';
	import Counter from './Counter.svelte';

	const propId = $props.id();
	let {
		/** Main statistic value to display */
		value,

		/** Descriptive label */
		label = undefined as string | undefined,

		/** Leading icon component */
		icon: Icon = undefined as Component<Record<string, never>> | undefined,

		/** Percentage change from previous period */
		change = undefined as number | undefined,

		/** Description for the change (e.g., "vs last month") */
		change_label = undefined as string | undefined,

		/** Override trend direction (auto-detected from change by default) */
		trend = undefined as 'up' | 'down' | 'neutral' | undefined,

		/** Component size */
		size = '1' as '0' | '1' | '2' | '3',

		/** Horizontal layout */
		horizontal = false,

		/** Animate value via Counter */
		animated = true,

		/** Prefix shown smaller and top-aligned alongside the value (e.g. "$") */
		prefix = undefined as string | undefined,

		/** Suffix shown smaller and top-aligned alongside the value (e.g. "%") */
		suffix = undefined as string | undefined,

		/** Number of decimal places for numeric values */
		decimals = 0,

		/** Show loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',
	}: {
		value: string | number;
		label?: string;
		icon?: Component<Record<string, never>>;
		change?: number;
		change_label?: string;
		trend?: 'up' | 'down' | 'neutral';
		size?: '0' | '1' | '2' | '3';
		horizontal?: boolean;
		animated?: boolean;
		prefix?: string;
		suffix?: string;
		decimals?: number;
		skeleton?: boolean;
		id?: string;
		class?: string;
	} = $props();

	let counter_ref = $state<{ restart: () => void } | undefined>(undefined);

	export function restart() {
		counter_ref?.restart();
	}

	const is_numeric = $derived(typeof value === 'number');

	const resolved_trend = $derived.by<'up' | 'down' | 'neutral'>(() => {
		if (trend) return trend;
		if (change === undefined || change === 0) return 'neutral';
		return change > 0 ? 'up' : 'down';
	});

	const trend_color = $derived.by<'success' | 'error' | 'neutral'>(() => {
		if (resolved_trend === 'up') return 'success';
		if (resolved_trend === 'down') return 'error';
		return 'neutral';
	});

	function formatChange(val: number): string {
		const sign = val > 0 ? '+' : '';
		const formatted =
			Math.abs(val) === Math.round(Math.abs(val)) ? val.toFixed(0) : val.toFixed(1);
		return `${sign}${formatted}%`;
	}

	const change_text = $derived(change !== undefined ? formatChange(change) : '');

	const change_aria_label = $derived.by(() => {
		if (change === undefined) return '';
		const direction =
			resolved_trend === 'up'
				? 'increased'
				: resolved_trend === 'down'
					? 'decreased'
					: 'unchanged';
		const amount = Math.abs(change).toFixed(1);
		const suffix = change_label ? `, ${change_label}` : '';
		return `${direction} by ${amount} percent${suffix}`;
	});
</script>

<div
	{id}
	class={['stat', `size-${size}`, class_name].filter(Boolean).join(' ')}
	class:horizontal
	class:skeleton>
	{#if skeleton}
		<div class="skeleton-wrap">
			{#if Icon}
				<div class="skeleton-icon"></div>
			{/if}
			<div class="skeleton-body">
				<div class="skeleton-value"></div>
				{#if label}
					<div class="skeleton-label"></div>
				{/if}
				{#if change !== undefined}
					<div class="skeleton-change"></div>
				{/if}
			</div>
		</div>
	{:else}
		{#if Icon}
			<div class="icon">
				<Icon />
			</div>
		{/if}

		<div class="body">
			<div class="value" aria-live="polite">
				{#if is_numeric && animated}
					<Counter
						bind:this={counter_ref}
						value={value as number}
						{prefix}
						{suffix}
						{decimals} />
				{:else}
					{#if prefix}<span class="affix prefix">{prefix}</span>{/if}
					{value}
					{#if suffix}<span class="affix suffix">{suffix}</span>{/if}
				{/if}
			</div>

			{#if label}
				<div class="label">{label}</div>
			{/if}

			{#if change !== undefined}
				<div class="change {trend_color}" aria-label={change_aria_label}>
					<svg
						class="arrow"
						width="14"
						height="14"
						viewBox="0 0 14 14"
						fill="none"
						aria-hidden="true">
						{#if resolved_trend === 'up'}
							<path
								d="M3 10L10 3M10 3H5M10 3V8"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round" />
						{:else if resolved_trend === 'down'}
							<path
								d="M3 4L10 11M10 11H5M10 11V6"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round" />
						{:else}
							<path
								d="M3 7H11M11 7L8 4M11 7L8 10"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round" />
						{/if}
					</svg>
					<span class="text">
						{change_text}{#if change_label}{' '}{change_label}{/if}
					</span>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.stat {
		--stat-value-font: 28px;
		--stat-label-font: 13px;
		--stat-icon-size: 28px;

		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;

		&.size-0 {
			--stat-value-font: 20px;
			--stat-label-font: 11px;
			--stat-icon-size: 20px;
		}
		&.size-1 {
			--stat-value-font: 28px;
			--stat-label-font: 13px;
			--stat-icon-size: 28px;
		}
		&.size-2 {
			--stat-value-font: 40px;
			--stat-label-font: 15px;
			--stat-icon-size: 36px;
		}
		&.size-3 {
			--stat-value-font: 56px;
			--stat-label-font: 17px;
			--stat-icon-size: 48px;
		}

		&.horizontal {
			flex-direction: row;
			align-items: center;
			gap: 0.75rem;
		}

		.icon {
			display: flex;
			align-items: center;
			justify-content: center;
			width: var(--stat-icon-size);
			height: var(--stat-icon-size);
			color: var(--color-action-fg, var(--color-action, light-dark(#3b82f6, #60a5fa)));
			flex-shrink: 0;

			:global(svg) {
				width: 100%;
				height: 100%;
			}
		}

		.body {
			display: flex;
			flex-direction: column;
			gap: 0.125rem;
			min-width: 0;
		}

		.value {
			font-size: var(--stat-value-font);
			font-weight: 600;
			line-height: 1.15;
			color: var(--color-text, light-dark(#111827, #f9fafb));
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
			display: inline-flex;
			align-items: flex-start;

			/* Counter resets line-height to 1 on itself; inherit ours so the
			   animated value occupies the same 1.15 line box as static values and
			   the skeleton (no height jump between skeleton ↔ loaded or
			   animated ↔ static). */
			> :global(.counter) {
				line-height: inherit;
			}
		}

		.affix {
			font-size: 0.5em;
			line-height: 1;
			font-weight: 500;
			opacity: 0.85;
			padding-top: 0.15em;
		}
		.prefix {
			margin-right: 0.1em;
		}
		.suffix {
			margin-left: 0.1em;
		}

		.label {
			font-size: var(--stat-label-font);
			line-height: 1.3;
			color: var(--color-text-muted, light-dark(#6b7280, #9ca3af));
			white-space: nowrap;
		}

		.change {
			display: inline-flex;
			align-items: center;
			gap: 0.2rem;
			font-size: var(--stat-label-font);
			line-height: 1.3;
			margin-top: 0.25rem;
			white-space: nowrap;

			&.success {
				color: var(--color-success, light-dark(#16a34a, #4ade80));
			}
			&.error {
				color: var(--color-error, light-dark(#dc2626, #f87171));
			}
			&.neutral {
				color: var(--color-text-muted, light-dark(#6b7280, #9ca3af));
			}

			.arrow {
				flex-shrink: 0;
			}

			.text {
				display: inline;
			}
		}
	}

	/* ── Skeleton ───────────────────────────────────────────────── */

	.stat.skeleton {
		pointer-events: none;
	}

	.skeleton-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;

		.stat.horizontal & {
			flex-direction: row;
			align-items: center;
			gap: 0.75rem;
		}
	}

	.skeleton-icon,
	.skeleton-value,
	.skeleton-label,
	.skeleton-change {
		position: relative;
		overflow: hidden;
		background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				105deg,
				transparent 25%,
				var(--skeleton-sheen, rgb(from var(--color-text, #888) r g b / 0.12)) 50%,
				transparent 75%
			);
			animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
				infinite;
			animation-delay: var(--shimmer-delay, 0s);
		}
	}

	.skeleton-icon {
		--shimmer-delay: 0ms;
		width: var(--stat-icon-size);
		height: var(--stat-icon-size);
		border-radius: var(--radius-md, 0.25rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 0.25rem) * var(--squircle-ratio, 2));
		}
		flex-shrink: 0;
	}

	/* Mirrors .body (gap 0.125rem); each bar pads itself out to the real
	   text line's height so the loaded stat lands without a shift. */
	.skeleton-body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	/* Value line: real font is --stat-value-font at line-height 1.15. */
	.skeleton-value {
		--shimmer-delay: 120ms;
		width: 6em;
		height: calc(var(--stat-value-font) * 0.7);
		margin-block: calc(var(--stat-value-font) * 0.225);
		border-radius: var(--radius-full, 1e5px);
	}

	/* Label / change lines: real font is --stat-label-font at line-height 1.3. */
	.skeleton-label,
	.skeleton-change {
		height: calc(var(--stat-label-font) * 0.7);
		margin-block: calc(var(--stat-label-font) * 0.3);
		border-radius: var(--radius-full, 1e5px);
	}

	.skeleton-label {
		--shimmer-delay: 240ms;
		width: 8em;
	}

	.skeleton-change {
		--shimmer-delay: 360ms;
		width: 10em;
		margin-top: calc(0.25rem + var(--stat-label-font) * 0.3);
	}

	@keyframes -global-delight-skeleton-shimmer {
		0% {
			transform: translateX(-100%);
		}
		55%,
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-icon::after,
		.skeleton-value::after,
		.skeleton-label::after,
		.skeleton-change::after {
			animation: none;
		}
	}
</style>
