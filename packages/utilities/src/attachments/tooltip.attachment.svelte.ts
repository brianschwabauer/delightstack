import { generateID } from './../helpers/id.helper.js';
import type { Attachment } from 'svelte/attachments';

/** Shows a tooltip message when the element is hovered/focused */
export function tooltip(tooltipMessage: string): Attachment<HTMLElement> {
	return (parent: HTMLElement) => {
		const oldDescribeBy = parent.getAttribute('aria-describedby');
		let el: HTMLDivElement | undefined;
		const message = (tooltipMessage || '').trim();
		let destroyed = false;

		function showTooltip() {
			if (!el) return;
			el.style.transform = 'scale(1)';
			el.style.opacity = '1';
		}

		function hideTooltip() {
			if (!el) return;
			el.style.transform = 'scale(.65)';
			el.style.opacity = '0';
		}

		let pointerEntered = false;
		let showTimer: ReturnType<typeof setTimeout>;
		function delayShowTooltip(e: PointerEvent | FocusEvent) {
			if (e.type !== 'focus') pointerEntered = true;
			if ('pointerType' in e && e.pointerType === 'touch') return;
			if (e.type === 'focus' && !pointerEntered) return;
			createTooltip();
			clearTimeout(showTimer);
			clearTimeout(hideTimer);
			showTimer = setTimeout(() => showTooltip(), 400);
		}

		let hideTimer: ReturnType<typeof setTimeout>;
		function delayHideTooltip(e: PointerEvent | FocusEvent) {
			if (e.type !== 'focus' && e.type !== 'blur') pointerEntered = false;
			pointerEntered = false;
			clearTimeout(showTimer);
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => hideTooltip(), 200);
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
				transition: `transform 150ms var(--ease-out-back, 'ease'), opacity 150ms`,
				'pointer-events': 'none',
				'z-index': '100',
				'box-shadow': 'var(--shadow-2)',
				'max-width': 'min(40ch, 90vw)',
				'border-radius': '10px',
				'font-size': '90%',
				'line-height': '1.3',
				'overflow-wrap': 'break-word',
			});
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
