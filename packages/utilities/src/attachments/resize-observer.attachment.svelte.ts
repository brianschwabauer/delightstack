import type { Attachment } from 'svelte/attachments';

let observer: ResizeObserver;
const elements = new WeakMap<
	Element,
	{
		callback: (element: Element) => void;
		initialized: boolean;
		timer?: ReturnType<typeof setTimeout>;
		debounce?: number;
	}
>();

/**
 * Observers when an element resizes and calls the callback function on every resize
 * @example
 * ```svelte
 * {@attach resizeObserver({
 * 		onresize: (element) => console.log('Element resized:', element),
 * })}
 */
export function resizeObserver({
	onresize,
	debounce,
}: {
	onresize: (element: Element) => void;
	debounce?: number;
}): Attachment<HTMLElement> {
	if (!observer) {
		observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const element = elements.get(entry.target);
				if (!element?.callback) continue;
				if (element?.debounce && element?.initialized) {
					clearTimeout(element.timer);
					element.timer = setTimeout(
						() => element.callback(entry.target),
						element?.debounce,
					);
				} else {
					element.callback(entry.target);
				}
				if (!element?.initialized)
					elements.set(entry.target, { ...element, initialized: true });
			}
		});
	}

	return (el: HTMLElement) => {
		elements.set(el, { callback: onresize, initialized: false, debounce });
		observer.observe(el);
		return () => {
			elements.delete(el);
			observer.unobserve(el);
		};
	};
}
