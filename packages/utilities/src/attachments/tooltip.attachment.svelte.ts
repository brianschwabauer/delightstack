import { generateID } from './../helpers/id.helper.js';
import type { Attachment } from 'svelte/attachments';

/**
 * Shared across every tooltip on the page: once one tooltip has shown, moving to
 * another tooltip while the group is "warm" shows it instantly instead of waiting
 * out the full show delay again. Leaving a tooltip starts a grace timer that lets
 * the warm window survive the gap between elements (they don't have to touch);
 * when it expires the next tooltip uses the normal delay again.
 */
let groupWarm = false;
let groupCooldownTimer: ReturnType<typeof setTimeout>;
/**
 * The currently-shown tooltip's "snap away instantly" callback. When a new
 * tooltip shows it dismisses this one with no out-animation, so a warm handoff
 * reads as a single tooltip moving and swapping text — and there's never two
 * tooltips visible at once to overlap/paint over each other. The tooltip you
 * leave for good is never dismissed this way, so it still fades out normally.
 */
let hideActiveTooltip: (() => void) | undefined;
const SHOW_DELAY = 400;
const HIDE_DELAY = 200;
const GROUP_GRACE_PERIOD = 400;
// NB: the fallback must be an unquoted easing keyword. A quoted 'ease' is an
// invalid <easing-function>, which makes the whole `transition` invalid at
// computed-value time and silently drops it — so the tooltip would snap in with
// no animation. `--ease-spring` is the overshoot (ease-out-back) curve shipped in
// @delightstack/styles; `ease` keeps the transition valid without that package.
const TOOLTIP_TRANSITION = `transform 150ms var(--ease-spring, ease), opacity 150ms`;

/** Shows a tooltip message when the element is hovered/focused */
export function tooltip(tooltipMessage: string): Attachment<HTMLElement> {
	return (parent: HTMLElement) => {
		const oldDescribeBy = parent.getAttribute('aria-describedby');
		let el: HTMLDivElement | undefined;
		const message = (tooltipMessage || '').trim();
		let destroyed = false;

		function showTooltip(instant = false) {
			if (!el) return;
			// Take over from whatever tooltip was showing: snap it away with no
			// out-animation so the handoff looks like one tooltip moving rather than
			// a cross-fade (and so the outgoing one can't paint over this one).
			if (hideActiveTooltip && hideActiveTooltip !== hideSelfInstantly)
				hideActiveTooltip();
			hideActiveTooltip = hideSelfInstantly;
			// When the group is warm we skip the enter animation entirely so moving
			// between tooltips feels immediate, instead of fading and scaling in from
			// scratch (a fresh node is created per tooltip) every single time.
			if (instant) el.style.transition = 'none';
			el.style.transform = 'scale(1)';
			el.style.opacity = '1';
			if (instant) {
				// Commit the no-transition jump, then restore the transition so the
				// tooltip still animates out on leave.
				void el.offsetHeight;
				el.style.transition = TOOLTIP_TRANSITION;
			}
			// The group is now warm — the next tooltip skips the show delay.
			groupWarm = true;
		}

		function hideTooltip(instant = false) {
			if (!el) return;
			// `instant` (no fade) is used when a newer tooltip takes over; the normal
			// path keeps the fade so leaving a tooltip for good still animates out.
			if (instant) el.style.transition = 'none';
			el.style.transform = 'scale(.65)';
			el.style.opacity = '0';
			if (instant) {
				void el.offsetHeight;
				el.style.transition = TOOLTIP_TRANSITION;
			}
		}
		// Stable identity so showTooltip can recognize "the active tooltip is me".
		const hideSelfInstantly = () => hideTooltip(true);

		let pointerEntered = false;
		let showTimer: ReturnType<typeof setTimeout>;
		function delayShowTooltip(e: PointerEvent | FocusEvent) {
			if (e.type !== 'focus') pointerEntered = true;
			if ('pointerType' in e && e.pointerType === 'touch') return;
			if (e.type === 'focus' && !pointerEntered) return;
			createTooltip();
			clearTimeout(showTimer);
			clearTimeout(hideTimer);
			// Keep the warm window alive while we're hovering this element.
			clearTimeout(groupCooldownTimer);
			// Warm group: pop in instantly with no enter animation. Cold start: wait
			// out the show delay, then fade in.
			if (groupWarm) showTooltip(true);
			else showTimer = setTimeout(() => showTooltip(), SHOW_DELAY);
		}

		let hideTimer: ReturnType<typeof setTimeout>;
		function delayHideTooltip(e: PointerEvent | FocusEvent) {
			if (e.type !== 'focus' && e.type !== 'blur') pointerEntered = false;
			pointerEntered = false;
			clearTimeout(showTimer);
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => hideTooltip(), HIDE_DELAY);
			// Leaving the element starts the grace period: enter another tooltip
			// before it elapses and that tooltip shows instantly; otherwise the
			// group goes cold and the next tooltip waits out the full delay.
			clearTimeout(groupCooldownTimer);
			groupCooldownTimer = setTimeout(() => (groupWarm = false), GROUP_GRACE_PERIOD);
		}
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') hideTooltip();
		}

		function detectTransformOrigin() {
			if (!el || !parent) return;
			const tooltipRect = el.getBoundingClientRect();
			const parentRect = parent.getBoundingClientRect();
			const tooltipMidY = (tooltipRect.top + tooltipRect.bottom) / 2;
			const parentMidY = (parentRect.top + parentRect.bottom) / 2;
			el.style.transformOrigin =
				tooltipMidY < parentMidY ? 'bottom center' : 'top center';
		}

		function createTooltip() {
			if (el) return;
			el = document.createElement('div');
			const id = generateID();
			const anchorName = `--tooltip-anchor-${id}`;
			parent.setAttribute('aria-describedby', id);
			(parent.style as any).anchorName = anchorName;
			el.id = id;
			el.setAttribute('role', 'tooltip');
			el.setAttribute('inert', 'true');
			el.innerText = message || '';
			Object.assign(el.style, {
				display: 'block',
				width: 'max-content',
				position: 'fixed',
				inset: 'auto',
				positionAnchor: anchorName,
				bottom: 'anchor(top)',
				justifySelf: 'anchor-center',
				marginBottom: '8px',
				positionTryFallbacks: 'flip-block',
				background: 'var(--panel, light-dark(#1f2937, #f3f4f6))',
				color: 'var(--panel-text, light-dark(#f9fafb, #111827))',
				padding: '10px 14px',
				opacity: '0',
				transform: 'scale(.65)',
				transition: TOOLTIP_TRANSITION,
				'pointer-events': 'none',
				'z-index': '100',
				'box-shadow': 'var(--shadow-2)',
				'max-width': 'min(40ch, 90vw)',
				'border-radius': '10px',
				'font-size': '90%',
				'line-height': '1.3',
				'overflow-wrap': 'break-word',
			});
			// Squircle corners where supported — the inline-style equivalent of the
			// nested `@supports (corner-shape: squircle)` block the components use
			// (double the radius by --squircle-ratio to keep the same visual curve).
			if (typeof CSS !== 'undefined' && CSS.supports('corner-shape', 'squircle')) {
				el.style.setProperty('corner-shape', 'squircle');
				el.style.borderRadius = 'calc(10px * var(--squircle-ratio, 2))';
			}
			let portal = document.querySelector('#tooltips');
			if (!portal) {
				portal = document.createElement('div');
				portal.id = 'tooltips';
				document.body.appendChild(portal);
			}
			portal.appendChild(el);
			if (destroyed) return;
			// Detect transform-origin after first layout
			requestAnimationFrame(() => detectTransformOrigin());
		}

		function startListening() {
			parent.addEventListener('pointerenter', delayShowTooltip);
			parent.addEventListener('pointerleave', delayHideTooltip);
			parent.addEventListener('focus', delayShowTooltip);
			parent.addEventListener('blur', delayHideTooltip);
			parent.addEventListener('keyup', onKeyDown);
		}
		function destroy() {
			destroyed = true;
			// Don't leave a removed tooltip registered as the active one.
			if (hideActiveTooltip === hideSelfInstantly) hideActiveTooltip = undefined;
			parent.removeEventListener('pointerenter', delayShowTooltip);
			parent.removeEventListener('pointerleave', delayHideTooltip);
			parent.removeEventListener('focus', delayShowTooltip);
			parent.removeEventListener('blur', delayHideTooltip);
			parent.removeEventListener('keyup', onKeyDown);
			parent.setAttribute('aria-describedby', oldDescribeBy || '');
			(parent.style as any).anchorName = '';
			if (el) el.remove();
			if (el) el = undefined;
		}

		if (message) startListening();
		return () => destroy();
	};
}
