<script lang="ts">
	/**
	 * The trailing saving spinner / saved checkmark Input and Select show while
	 * an async `onchange` runs (see async-change.svelte.ts). Internal: not
	 * exported from the package.
	 */
	import { fade, type TransitionConfig } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import Progress from '../feedback/Progress.svelte';
	import type { AsyncChange } from './async-change.svelte.js';

	let { status }: { status: AsyncChange } = $props();

	/** Same entrance as Button's: a spring pop while the tick draws itself on. */
	function checkIn(_node: Element): TransitionConfig {
		const reduce =
			typeof matchMedia !== 'undefined' &&
			matchMedia('(prefers-reduced-motion: reduce)').matches;
		return {
			duration: reduce ? 0 : 440,
			easing: backOut,
			css: (t: number) =>
				`transform: scale(${0.3 + 0.7 * t}); opacity: ${Math.min(1, t * 2)}; --check-draw: ${24 * (1 - t)};`,
		};
	}
</script>

{#if status.spinner || status.check}
	<span class="save-status" transition:fade={{ duration: 200 }}>
		{#if status.spinner}
			<span class="layer" out:fade={{ duration: 120 }}>
				<Progress size="00" color="currentColor" />
			</span>
		{:else}
			<span class="layer check" in:checkIn>
				<svg
					viewBox="2 2 20 20"
					fill="none"
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true">
					<path d="M5 12.5l4.5 4.5L19 7" />
				</svg>
			</span>
		{/if}
	</span>
{/if}
<!-- Announced without moving focus; a failure is announced by the field's error -->
<span class="visually-hidden" aria-live="polite">{status.check ? 'Saved' : ''}</span>

<style>
	.save-status {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		width: 1.25em;
		height: 1.25em;
		color: var(--color-text-muted, currentColor);
		:global(circle.track) {
			stroke: rgb(from currentColor r g b / 0.2);
		}
	}
	.layer {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.check {
		color: var(--color-success-fg, var(--color-success, #16a34a));
		svg {
			display: block;
			width: 100%;
			height: 100%;
		}
		path {
			stroke-dasharray: 24;
			stroke-dashoffset: var(--check-draw, 0);
		}
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
