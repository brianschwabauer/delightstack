// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Attachment } from 'svelte/attachments';

/**
 * Options for `intersect` extends {@link https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver | IntersectionObserverInit }
 * (second parameter passed to IntersectionObserver constructor)
 */
export interface IntersectOptions extends IntersectionObserverInit {
	/** whether to activate the action. Default to `true` */
	enabled?: boolean;

	/** Called when the element is intersecting with the observer/root */
	onintersect?: (event: IntersectDetail) => void;

	/** Called once the element is intersecting with the observer/root */
	onintersectonce?: (event: IntersectDetail) => void;

	/** Called every time the intersect status changes - whether intersecting or not */
	onintersectchange?: (event: IntersectDetail) => void;
}

/**
 * `detail` payload for `intersect` and `intersectonce` CustomEvent
 * @public
 */
export interface IntersectDetail extends Readonly<IntersectionObserverEntry> {
	/** scrolling direction */
	readonly direction: 'up' | 'down';
}

/**
 * Create an IntersectionObserver that observers the node
 * @public
 *
 * @example
 * Typical use to observe the first time the node intersects with viewport for transition effect (like fade-in)
 *
 * ```svelte
 * <script lang="ts">
 *  import { intersectionObserver } from '@delightstack/utlities';
 *  let show = $state(false);
 * </script>
 *
 * <section
 *  style={show ? 'display: block' : 'display: none'}
 *  {@attach intersectionObserver({ onintersect: (detail) => (show = detail.isIntersecting) })}>
 *  <p>
 *    A section that will be shown when it intersects with the viewport.
 *  </p>
 * </section>
 * ```
 */
export function intersectionObserver(
	options?: IntersectOptions,
): Attachment<HTMLElement> {
	let hasIntersect = false;
	let previousY = 0;
	let observer: IntersectionObserver | undefined;
	return (el: HTMLElement) => {
		let onintersect = options?.onintersect;
		let onintersectonce = options?.onintersectonce;
		let onintersectchange = options?.onintersectchange;

		let { root, rootMargin, threshold } = options || {};
		const callback: IntersectionObserverCallback = (entries) => {
			const y = entries[0].boundingClientRect.y ?? 0;
			const direction = y < previousY ? 'down' : 'up';
			const detail: IntersectDetail = {
				direction,
				boundingClientRect: entries[0].boundingClientRect,
				intersectionRatio: entries[0].intersectionRatio,
				intersectionRect: entries[0].intersectionRect,
				isIntersecting: entries[0].isIntersecting,
				rootBounds: entries[0].rootBounds,
				target: entries[0].target,
				time: entries[0].time,
			};
			if (onintersectchange) onintersectchange(detail);
			if (entries.some((e) => !!e.intersectionRatio)) {
				if (onintersect) onintersect(detail);
				if (!hasIntersect && entries.some((e) => e.isIntersecting)) {
					if (onintersectonce) onintersectonce(detail);
					hasIntersect = true;
				}
			}
			previousY = y;
		};
		if (options?.enabled === false) {
			if (observer) observer.unobserve(el);
		}
		if (options?.enabled !== false) {
			if (observer) observer.disconnect();
			observer = new IntersectionObserver(callback, {
				root,
				rootMargin,
				threshold,
			});
			observer.observe(el);
		}
		return () => observer.disconnect();
	};
}
