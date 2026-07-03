import { backOut, cubicIn } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/**
 * Shared enter/exit transitions for the editor's menu surfaces (slash menu,
 * gutter menu). Entrances use the same back-out scale as the design system's
 * Popover so all opening panels move with one voice; exits are a quick fade.
 * The always-on toolbars (floating selection menu, block chrome) don't
 * animate in at all — they appear instantly so they feel like part of the
 * pointer, not a separate surface.
 * Durations collapse to 0 under `prefers-reduced-motion`.
 */

export function prefersReducedMotion(): boolean {
	return (
		typeof matchMedia === 'function' &&
		matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}

/**
 * Entrance matching Popover: fade + back-out scale from 0.7, growing out of
 * the anchor side. Pass the `origin` nearest the anchor, e.g. `top left`
 * when the menu opens below-right of the caret (default `top center`).
 */
export function surfaceIn(
	_node: Element,
	{ origin = 'top center' }: { origin?: string } = {},
): TransitionConfig {
	if (prefersReducedMotion()) return { duration: 0 };
	return {
		duration: 200,
		easing: backOut,
		css: (t) =>
			`transform-origin: ${origin}; opacity: ${Math.min(1, t)}; scale: ${0.7 + t * 0.3};`,
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
