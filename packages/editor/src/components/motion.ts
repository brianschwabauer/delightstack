import { cubicIn, cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/**
 * Shared enter/exit transitions for the editor's floating surfaces (slash
 * menu, floating toolbar, gutter menu, settings popover) so they all move
 * with one voice: scale + rise in on `--ease-out`, quick fade out.
 * Durations collapse to 0 under `prefers-reduced-motion`.
 */

export function prefersReducedMotion(): boolean {
	return (
		typeof matchMedia === 'function' &&
		matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

/**
 * Entrance: fade + scale(0.96→1) + a 4px drift from the anchor side.
 * Pass `y: 4` when the surface opens above its anchor (it drifts up into
 * place), `-4` (default) when it opens below.
 */
export function surfaceIn(
	_node: Element,
	{ y = -4 }: { y?: number } = {},
): TransitionConfig {
	if (prefersReducedMotion()) return { duration: 0 };
	return {
		duration: 140,
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; translate: 0 ${u * y}px; scale: ${0.96 + t * 0.04};`,
	};
}

/** Exit: fast opacity-only fade — getting out of the way beats spectacle. */
export function surfaceOut(_node: Element): TransitionConfig {
	if (prefersReducedMotion()) return { duration: 0 };
	return {
		duration: 90,
		easing: cubicIn,
		css: (t) => `opacity: ${t};`,
	};
}
