<script lang="ts">
	import Portal from '../actions/Portal.svelte';

	const propId = $props.id();
	let {
		/** Progress value (0–100). Omit for indeterminate */
		value = undefined as number | undefined,

		/** Maximum value */
		max = 100,

		/** Circular mode (false = linear bar) */
		circular = true,

		/** Force indeterminate animation regardless of value */
		loading = false,

		/** Size of the indicator */
		size = '1' as '00' | '0' | '1' | '2' | '3',

		/** Custom fill color (overrides currentColor) */
		color = undefined as string | undefined,

		/** Text label (below spinner or beside bar) */
		label = undefined as string | undefined,

		/** Display the current percentage */
		show_value = false,

		/** Striped animation on fill (linear mode only) */
		striped = false,

		/** Cover parent element with backdrop */
		overlay = false,

		/** Cover entire viewport */
		full_screen = false,

		/** Success color variant */
		success = false,

		/** Error color variant */
		error = false,

		/** Multi-segment progress (linear only) */
		segments = undefined as
			| Array<{ value: number; color?: string; label?: string }>
			| undefined,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',
	} = $props();

	const isIndeterminate = $derived(value === undefined || loading);
	const percentage = $derived(
		value !== undefined ? Math.min(100, Math.max(0, (value / max) * 100)) : 0,
	);

	const CIRCULAR_SIZES: Record<string, { diameter: number; stroke: number }> = {
		'00': { diameter: 16, stroke: 2 },
		'0': { diameter: 24, stroke: 2.5 },
		'1': { diameter: 40, stroke: 3 },
		'2': { diameter: 64, stroke: 4 },
		'3': { diameter: 96, stroke: 5 },
	};

	const LINEAR_HEIGHTS: Record<string, number> = {
		'00': 2,
		'0': 4,
		'1': 8,
		'2': 12,
		'3': 16,
	};

	const circularConfig = $derived(CIRCULAR_SIZES[size] || CIRCULAR_SIZES['1']);
	const linearHeight = $derived(LINEAR_HEIGHTS[size] || LINEAR_HEIGHTS['1']);
	const radius = $derived((circularConfig.diameter - circularConfig.stroke) / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const dashOffset = $derived(circumference - (percentage / 100) * circumference);

	const segmentTotal = $derived(
		segments ? segments.reduce((sum, s) => sum + s.value, 0) : 0,
	);
</script>

{#snippet progressContent()}
	<div
		class={['progress', class_name].filter(Boolean).join(' ')}
		class:circular
		class:linear={!circular}
		class:indeterminate={isIndeterminate}
		class:determinate={!isIndeterminate}
		class:overlay
		class:full-screen={full_screen}
		class:success
		class:error
		class:striped={striped && !circular}
		{id}
		role={isIndeterminate ? 'status' : 'progressbar'}
		aria-valuenow={isIndeterminate ? undefined : Math.round(percentage)}
		aria-valuemin={isIndeterminate ? undefined : 0}
		aria-valuemax={isIndeterminate ? undefined : 100}
		aria-label={label ||
			(isIndeterminate ? 'Loading' : `${Math.round(percentage)}% complete`)}
		style:--progress-color={color || null}>
		{#if circular}
			<svg
				class="spinner"
				width={circularConfig.diameter}
				height={circularConfig.diameter}
				viewBox="0 0 {circularConfig.diameter} {circularConfig.diameter}">
				<circle
					class="track"
					cx={circularConfig.diameter / 2}
					cy={circularConfig.diameter / 2}
					r={radius}
					fill="none"
					stroke-width={circularConfig.stroke} />
				<circle
					class="arc"
					cx={circularConfig.diameter / 2}
					cy={circularConfig.diameter / 2}
					r={radius}
					fill="none"
					stroke-width={circularConfig.stroke}
					stroke-linecap="round"
					stroke-dasharray={circumference}
					stroke-dashoffset={isIndeterminate ? undefined : dashOffset}
					style:--spinner-c="{circumference}px"
					transform="rotate(-90 {circularConfig.diameter / 2} {circularConfig.diameter /
						2})" />
			</svg>
			{#if show_value && !isIndeterminate && size !== '00' && size !== '0'}
				<span class="value">{Math.round(percentage)}%</span>
			{/if}
		{:else}
			<div class="track" style:height="{linearHeight}px">
				{#if segments && segments.length > 0}
					{#each segments as segment}
						<div
							class="fill segment"
							style:width="{(segment.value / (segmentTotal || 1)) * 100}%"
							style:background={segment.color || null}>
						</div>
					{/each}
				{:else if isIndeterminate}
					<div class="fill indeterminate-bar"></div>
				{:else}
					<div class="fill" style:width="{percentage}%"></div>
				{/if}
			</div>
			{#if show_value && !isIndeterminate}
				<span class="value">{Math.round(percentage)}%</span>
			{/if}
		{/if}
		{#if label}
			<span class="label">{label}</span>
		{/if}
	</div>
{/snippet}

{#if full_screen}
	<Portal>
		{@render progressContent()}
	</Portal>
{:else}
	{@render progressContent()}
{/if}

<style>
	.progress {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 0.5rem;
		color: currentColor;
		position: relative;

		&.circular {
			.spinner {
				display: block;
			}
			&.indeterminate .spinner {
				animation: progress-rotate 1.2s linear infinite;
			}
			&.indeterminate .arc {
				/* Desynced from the rotate period so the wrap drifts around the
				   circle instead of pulsing at a fixed spot every loop. */
				animation: progress-dash 0.9s ease-in-out infinite;
				transition: none;
			}
			circle.track {
				stroke: var(--color-border, rgb(0 0 0 / 0.1));
			}
			circle.arc {
				stroke: var(--progress-color, var(--color-action, currentColor));
				transition: stroke-dashoffset var(--duration-slow, 300ms)
					var(--ease-out, ease-out);
			}
			.value {
				position: absolute;
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%);
				font-size: 0.625em;
				font-weight: 600;
				line-height: 1;
			}
		}

		&.linear {
			width: 100%;
			flex-direction: row;
			gap: 0.75rem;

			.track {
				flex: 1;
				border-radius: var(--radius-full, 9999px);
				background: var(--color-border, rgb(0 0 0 / 0.1));
				overflow: hidden;
				position: relative;
				display: flex;
			}

			.fill {
				height: 100%;
				background: var(--progress-color, var(--color-action, currentColor));
				border-radius: inherit;
				@supports (corner-shape: squircle) {
					corner-shape: inherit;
				}
				transition: width var(--duration-slow, 300ms) var(--ease-out, ease-out);
			}

			.fill.indeterminate-bar {
				width: 40%;
				position: absolute;
				animation: progress-slide 1.5s ease-in-out infinite;
			}

			.value {
				font-size: var(--text-sm, 0.875rem);
				font-weight: 500;
				white-space: nowrap;
				min-width: 3ch;
				text-align: right;
			}

			.label {
				font-size: var(--text-sm, 0.875rem);
				color: var(--color-text-muted, inherit);
			}

			&.striped .fill:not(.indeterminate-bar) {
				background-image: linear-gradient(
					45deg,
					rgba(255, 255, 255, 0.15) 25%,
					transparent 25%,
					transparent 50%,
					rgba(255, 255, 255, 0.15) 50%,
					rgba(255, 255, 255, 0.15) 75%,
					transparent 75%
				);
				background-size: 1rem 1rem;
				animation: progress-stripe 0.5s linear infinite;
			}
		}

		&.overlay {
			position: absolute;
			inset: 0;
			background: var(--color-backdrop, rgb(0 0 0 / 0.5));
			backdrop-filter: blur(2px);
			z-index: var(--layer-modal, 400);
			flex-direction: column;
		}

		&.full-screen {
			position: fixed;
			inset: 0;
			background: var(--color-backdrop, rgb(0 0 0 / 0.5));
			backdrop-filter: blur(2px);
			z-index: var(--layer-modal, 400);
			flex-direction: column;
		}

		&.success {
			circle.arc {
				stroke: var(--color-success, #16a34a);
			}
			.fill {
				background: var(--color-success, #16a34a);
			}
		}

		&.error {
			circle.arc {
				stroke: var(--color-error, #dc2626);
			}
			.fill {
				background: var(--color-error, #dc2626);
			}
		}
	}

	@keyframes progress-rotate {
		100% {
			transform: rotate(360deg);
		}
	}

	/* Arc grows from a near-dot to a long arc in the first half, then holds its
	   length and slides forward via stroke-dashoffset in the second half. The
	   arc never collapses to a dot mid-view, so there's no pause — the only
	   shrink is at the wrap, hidden by the (desynced) rotation. All values are
	   derived from the actual circumference (--spinner-c) so it's correct at
	   every size. The asymmetric grow-then-slide keeps the start/end caps
	   moving at different rates. */
	@keyframes progress-dash {
		0% {
			stroke-dasharray: calc(var(--spinner-c) * 0.01) calc(var(--spinner-c) * 1.6);
			stroke-dashoffset: 0;
		}
		50% {
			stroke-dasharray: calc(var(--spinner-c) * 0.7) calc(var(--spinner-c) * 1.6);
			stroke-dashoffset: calc(var(--spinner-c) * -0.28);
		}
		100% {
			stroke-dasharray: calc(var(--spinner-c) * 0.7) calc(var(--spinner-c) * 1.6);
			stroke-dashoffset: calc(var(--spinner-c) * -0.98);
		}
	}

	@keyframes progress-slide {
		0% {
			left: -40%;
		}
		100% {
			left: 100%;
		}
	}

	@keyframes progress-stripe {
		0% {
			background-position: 1rem 0;
		}
		100% {
			background-position: 0 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.progress {
			&.circular.indeterminate .spinner {
				animation: none;
			}
			&.circular.indeterminate .arc {
				animation: none;
				stroke-dasharray: calc(var(--spinner-c) * 0.65) calc(var(--spinner-c) * 1.6);
				stroke-dashoffset: 0;
			}
			&.linear .fill.indeterminate-bar {
				animation: none;
				left: 0;
			}
			&.linear.striped .fill {
				animation: none;
			}
		}
	}
</style>
