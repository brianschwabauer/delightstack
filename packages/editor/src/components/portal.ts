/**
 * Minimal portal action: moves the element to `document.body` (or a target)
 * so fixed-position menus escape overflow/transform contexts. Local to the
 * editor package because `@delightstack/components` is an optional peer.
 */
export function portal(el: HTMLElement, target: HTMLElement | string = 'body') {
	const resolved =
		typeof target === 'string'
			? (document.querySelector(target) ?? document.body)
			: target;
	resolved.appendChild(el);
	return {
		destroy() {
			el.remove();
		},
	};
}
