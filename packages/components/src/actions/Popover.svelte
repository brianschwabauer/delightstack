<script lang="ts" module>
	export type PopoverPlacement =
		| 'top'
		| 'top-start'
		| 'top-end'
		| 'bottom'
		| 'bottom-start'
		| 'bottom-end'
		| 'left'
		| 'left-start'
		| 'left-end'
		| 'right'
		| 'right-start'
		| 'right-end';
	export type PopoverStrategy = 'fixed' | 'absolute';
	type Corner = 'tl' | 'tr' | 'br' | 'bl';
</script>

<script lang="ts">
	import { scale } from 'svelte/transition';
	import { backOut, backIn } from 'svelte/easing';
	import { focusTrap } from '@delightstack/utilities';
	import { tick, untrack, type Snippet } from 'svelte';
	import Portal from './Portal.svelte';
	import { scrollbar } from './scrollbar';

	const propId = $props.id();
	let {
		/** The HTML element that the popover will be attached to */
		ref_element = $bindable() as HTMLElement | undefined,

		/** Whether the popover is currently open */
		opened = $bindable(false) as boolean,

		/** Where the popover should be attempted to be placed (it can move to fit on screen) */
		placement = 'bottom' as PopoverPlacement,

		/** How the item should be placed with css */
		strategy = 'fixed' as PopoverStrategy,

		/** Whether the 'arrow' pointing to the target element should be shown */
		arrow = true,

		/** The x position (in px) where the popover's ref_element/target is. This is used for context menu (right click) */
		x = undefined as number | undefined,

		/** The y position (in px) where the popover's ref_element/target is. This is used for context menu (right click) */
		y = undefined as number | undefined,

		/** Whether the popover should open when the ref element is hover overed */
		open_on_hover = false,

		/** Whether the popover should open when the ref element is clicked */
		open_on_click = false,

		/** Whether the popover should open when the ref element is focused (closes on blur) */
		open_on_focus = false,

		/** Whether the popover should close when clicked outside of the popover */
		close_on_outside_click = true,

		/** Whether the popover should close when a button like element is clicked inside of the popover */
		close_on_inside_click = false,

		/** Whether the popover should close when the escape key is pressed */
		close_on_escape_key = true,

		/** Whether the intial focus should not be set automatically when opening the popover */
		disable_initial_focus = false,

		/** The number of milliseconds that the popover wait before popping up. Only applies when 'open_on_hover' is true */
		hover_delay = 100,

		/**
		 * Whether the popover panel should be transparent — removes the background,
		 * border, shadow, padding, and arrow so inner content (e.g. a List) provides
		 * its own surface.
		 */
		transparent = false,

		/** Whether the popover should have less padding */
		dense = false,

		/** Whether the popover should have more padding */
		comfortable = false,

		/** The border radius of the popover */
		radius = undefined as string | undefined,

		/** The content shown in the element */
		children = undefined as undefined | Snippet,

		/** The id of the popover element */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: class_name = '',

		/** The css style string added to the component from the parent */
		style = '',
	} = $props();

	const ARROW_SIZE = 20;
	/** Half the arrow's visible base (element + fillet shoulders) plus breathing room */
	const ARROW_HALF_BASE = ARROW_SIZE / 2 + 4;
	/** Minimum gap kept between the popover and the viewport edges when shifting */
	const VIEWPORT_MARGIN = 8;
	const OFFSET = 4;
	const OFFSET_WITH_ARROW = 12;
	const TRANSITION_IN_DURATION = 200;
	const TRANSITION_OUT_DURATION = 150;

	let popoverElement = $state<HTMLElement | undefined>(undefined);
	let arrowElement = $state<HTMLElement | undefined>(undefined);
	let left = $state('0px');
	// Initial off-screen park depends only on the mount-time strategy; the
	// positioning code assigns `top` on every reposition afterwards.
	let top = $state(untrack(() => (strategy === 'fixed' ? '-1000px' : '0px')));
	let hitBoxLength = $state(0); // the total length of the hit box
	let hitBoxLengthA = $state(0); // the length of the long side of the trapezoid
	let hitBoxLengthB = $state(0); // the length of the short side of the trapezoid
	let hitBoxLengthZ = $state(0); // the length of the 'height' of the trapezoid
	let hitBoxOffsetA = $state(0); // How far the long side of the trapezoid is from the edge of the hit box
	let hitBoxOffsetB = $state(0); // How far the short side of the trapezoid is from the edge of the hit box
	let transformOrigin = $state(`top center`);
	let arrowX = $state('');
	let arrowY = $state('');
	// Seeded from the prop once; the positioning code recomputes it (flipping
	// when the preferred placement doesn't fit) on every reposition.
	let realPlacement = $state(untrack(() => placement));
	let forcedOpened = $state(false);
	let positioned = $state(false);
	let popoverIndex = $state(0);
	let shiftX = $state(0); // px the popover is nudged along x so the arrow can point at the target
	let shiftY = $state(0); // px the popover is nudged along y so the arrow can point at the target
	let cornerRadii = $state<Partial<Record<Corner, string>>>({}); // per-corner radius overrides (corner flattening)
	let baseRadiusCache: Partial<Record<Corner, number>> = {};

	const anchorOffset = $derived(arrow ? OFFSET_WITH_ARROW : OFFSET);

	const hitBoxShape = $derived.by(() => {
		const points: string[] = [];
		if (realPlacement.startsWith('bottom')) {
			points.push(`M${hitBoxOffsetA},${hitBoxLengthZ}`);
			points.push(`L${hitBoxOffsetB},0`);
			points.push(`l${hitBoxLengthB},0`);
			points.push(`L${hitBoxOffsetA + hitBoxLengthA},${hitBoxLengthZ}`);
			points.push(`L${hitBoxOffsetA},${hitBoxLengthZ}`);
		} else if (realPlacement.startsWith('top')) {
			points.push(`M${hitBoxOffsetA},0`);
			points.push(`L${hitBoxOffsetB},${hitBoxLengthZ}`);
			points.push(`l${hitBoxLengthB},0`);
			points.push(`L${hitBoxOffsetA + hitBoxLengthA},0`);
			points.push(`L${hitBoxOffsetA},0`);
		} else if (realPlacement.startsWith('left')) {
			points.push(`M0,${hitBoxOffsetA}`);
			points.push(`L${hitBoxLengthZ},${hitBoxOffsetB}`);
			points.push(`l0,${hitBoxLengthB}`);
			points.push(`L0,${hitBoxOffsetA + hitBoxLengthA}`);
			points.push(`L0,${hitBoxOffsetA}`);
		} else if (realPlacement.startsWith('right')) {
			points.push(`M${hitBoxLengthZ},${hitBoxOffsetA}`);
			points.push(`L0,${hitBoxOffsetB}`);
			points.push(`l0,${hitBoxLengthB}`);
			points.push(`L${hitBoxLengthZ},${hitBoxOffsetA + hitBoxLengthA}`);
			points.push(`L${hitBoxLengthZ},${hitBoxOffsetA}`);
		}
		return points.join(' ');
	});

	// Determine when the portal component should be shown
	// This is necessary because the portal component needs to exist while the popover is animating away
	let portalOpened = $state(false);
	let portalOpenedTimeout: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		clearTimeout(portalOpenedTimeout);
		if (opened) {
			portalOpened = true;
		} else {
			portalOpenedTimeout = setTimeout(() => {
				if (untrack(() => !opened)) portalOpened = false;
			}, TRANSITION_OUT_DURATION);
		}
	});

	// Show the popover with a small delay to trigger the intro animation to play
	let shown = $state(false);
	$effect(() => {
		if (opened) {
			// Reset arrow/corner state from a previous open before measuring anew
			baseRadiusCache = {};
			cornerRadii = {};
			shiftX = 0;
			shiftY = 0;
			tick().then(() => (shown = true));
		} else {
			shown = false;
		}
	});

	// Set anchor-name on ref_element before DOM update so CSS anchor positioning resolves on first paint
	$effect.pre(() => {
		if (shown && ref_element) {
			const el = ref_element;
			(el.style as any).anchorName = `--popover-anchor-${id}`;
		}
	});

	// CSS anchor positioning style for real element path
	const anchorPositionStyle = $derived.by(() => {
		if (!ref_element) return '';
		const anchor = `--popover-anchor-${id}`;
		const parts = [`position: ${strategy}`, `position-anchor: ${anchor}`, 'inset: auto'];
		switch (placement) {
			case 'bottom':
				parts.push(
					`top: anchor(bottom)`,
					`justify-self: anchor-center`,
					`margin-top: ${anchorOffset}px`,
					`position-try-fallbacks: flip-block`,
				);
				break;
			case 'bottom-start':
				parts.push(
					`top: anchor(bottom)`,
					`left: anchor(left)`,
					`margin-top: ${anchorOffset}px`,
					`position-try-fallbacks: flip-block`,
				);
				break;
			case 'bottom-end':
				parts.push(
					`top: anchor(bottom)`,
					`right: anchor(right)`,
					`margin-top: ${anchorOffset}px`,
					`position-try-fallbacks: flip-block`,
				);
				break;
			case 'top':
				parts.push(
					`bottom: anchor(top)`,
					`justify-self: anchor-center`,
					`margin-bottom: ${anchorOffset}px`,
					`position-try-fallbacks: flip-block`,
				);
				break;
			case 'top-start':
				parts.push(
					`bottom: anchor(top)`,
					`left: anchor(left)`,
					`margin-bottom: ${anchorOffset}px`,
					`position-try-fallbacks: flip-block`,
				);
				break;
			case 'top-end':
				parts.push(
					`bottom: anchor(top)`,
					`right: anchor(right)`,
					`margin-bottom: ${anchorOffset}px`,
					`position-try-fallbacks: flip-block`,
				);
				break;
			case 'left':
				parts.push(
					`right: anchor(left)`,
					`align-self: anchor-center`,
					`margin-right: ${anchorOffset}px`,
					`position-try-fallbacks: flip-inline`,
				);
				break;
			case 'left-start':
				parts.push(
					`right: anchor(left)`,
					`top: anchor(top)`,
					`margin-right: ${anchorOffset}px`,
					`position-try-fallbacks: flip-inline`,
				);
				break;
			case 'left-end':
				parts.push(
					`right: anchor(left)`,
					`bottom: anchor(bottom)`,
					`margin-right: ${anchorOffset}px`,
					`position-try-fallbacks: flip-inline`,
				);
				break;
			case 'right':
				parts.push(
					`left: anchor(right)`,
					`align-self: anchor-center`,
					`margin-left: ${anchorOffset}px`,
					`position-try-fallbacks: flip-inline`,
				);
				break;
			case 'right-start':
				parts.push(
					`left: anchor(right)`,
					`top: anchor(top)`,
					`margin-left: ${anchorOffset}px`,
					`position-try-fallbacks: flip-inline`,
				);
				break;
			case 'right-end':
				parts.push(
					`left: anchor(right)`,
					`bottom: anchor(bottom)`,
					`margin-left: ${anchorOffset}px`,
					`position-try-fallbacks: flip-inline`,
				);
				break;
		}
		return parts.join('; ') + ';';
	});

	// Computed position style (anchor positioning for real elements, left/top for virtual)
	const positionStyle = $derived.by(() => {
		if (ref_element) return anchorPositionStyle;
		return `position: ${strategy}; left: ${left}; top: ${top};`;
	});

	const CORNER_PROPS: Record<Corner, string> = {
		tl: 'border-top-left-radius',
		tr: 'border-top-right-radius',
		br: 'border-bottom-right-radius',
		bl: 'border-bottom-left-radius',
	};

	/**
	 * Reads the popover's rendered corner radius in px (this includes the
	 * squircle doubling when `corner-shape: squircle` is supported). Cached per
	 * open: once a corner is flattened (or mid radius-transition) its computed
	 * value no longer reflects the base radius the clamp math needs.
	 */
	function readCornerRadius(corner: Corner): number {
		const cached = baseRadiusCache[corner];
		if (cached !== undefined) return cached;
		if (!popoverElement) return 0;
		const value = parseFloat(
			getComputedStyle(popoverElement).getPropertyValue(CORNER_PROPS[corner]),
		);
		const radius = Number.isFinite(value) ? value : 0;
		baseRadiusCache[corner] = radius;
		return radius;
	}

	/** The two popover corners on the edge the arrow sits on (start = top/left side first) */
	function edgeCornersFor(p: string): [Corner, Corner] {
		if (p.startsWith('bottom')) return ['tl', 'tr']; // arrow on the popover's top edge
		if (p.startsWith('top')) return ['bl', 'br']; // arrow on the bottom edge
		if (p.startsWith('right')) return ['tl', 'bl']; // arrow on the left edge
		return ['tr', 'br']; // placement 'left*' → arrow on the right edge
	}

	/**
	 * Resolves where the arrow may sit along a popover edge without its base
	 * invading the rounded corners. Preference order:
	 * 1. Leave the arrow at `ideal` (pointing at the target) when it already
	 *    sits on the straight segment of the edge.
	 * 2. Otherwise shift the whole popover along the edge (bounded by the
	 *    viewport) so the arrow clears the corner AND still points at the target.
	 * 3. If the viewport blocks shifting far enough, shave the invaded corner's
	 *    radius down exactly as much as needed so the arrow blends into a
	 *    flatter corner instead of overlapping the curve.
	 *
	 * Returns the arrow center in final (shifted) popover coordinates, the
	 * popover shift, and per-corner radius overrides (undefined = keep base).
	 */
	function resolveArrowAlongEdge(
		ideal: number, // ideal arrow center relative to the unshifted popover start edge
		length: number, // popover size along the edge
		startRadius: number,
		endRadius: number,
		shiftMin: number, // most negative popover shift the viewport allows
		shiftMax: number, // most positive popover shift the viewport allows
	): {
		arrow: number;
		shift: number;
		start_radius: number | undefined;
		end_radius: number | undefined;
	} {
		const minStart = startRadius + ARROW_HALF_BASE;
		const minEnd = length - endRadius - ARROW_HALF_BASE;
		let arrow = ideal;
		let shift = 0;
		let start_radius: number | undefined;
		let end_radius: number | undefined;
		if (ideal < minStart) {
			shift = Math.max(ideal - minStart, Math.min(shiftMin, 0));
			arrow = ideal - shift;
			if (arrow < minStart) {
				start_radius = Math.max(0, arrow - ARROW_HALF_BASE);
				arrow = Math.max(ARROW_HALF_BASE, arrow);
			}
		} else if (ideal > minEnd) {
			shift = Math.min(ideal - minEnd, Math.max(shiftMax, 0));
			arrow = ideal - shift;
			if (arrow > minEnd) {
				end_radius = Math.max(0, length - arrow - ARROW_HALF_BASE);
				arrow = Math.min(length - ARROW_HALF_BASE, arrow);
			}
		}
		return { arrow, shift, start_radius, end_radius };
	}

	/** Builds the per-corner radius override map from a resolveArrowAlongEdge result */
	function cornerOverrides(
		start: Corner,
		end: Corner,
		startRadius: number | undefined,
		endRadius: number | undefined,
	): Partial<Record<Corner, string>> {
		const overrides: Partial<Record<Corner, string>> = {};
		if (startRadius !== undefined) overrides[start] = `${startRadius}px`;
		if (endRadius !== undefined) overrides[end] = `${endRadius}px`;
		return overrides;
	}

	function getTransformOrigin(p: string): string {
		if (p.startsWith('top')) return 'bottom center';
		if (p.startsWith('bottom')) return 'top center';
		if (p.startsWith('left')) return 'center right';
		if (p.startsWith('right')) return 'center left';
		return 'top center';
	}

	/** Detects actual placement after CSS anchor positioning resolves, then updates arrow/transform-origin/hit-box */
	function detectAndUpdate() {
		if (!popoverElement || !ref_element) return;
		const popRect = popoverElement.getBoundingClientRect();
		const refRect = ref_element.getBoundingClientRect();

		// Detect primary axis based on which side of the ref the popover ended up
		const suffix = placement.includes('-') ? '-' + placement.split('-')[1] : '';
		if (placement.startsWith('bottom') || placement.startsWith('top')) {
			const popMidY = (popRect.top + popRect.bottom) / 2;
			const refMidY = (refRect.top + refRect.bottom) / 2;
			realPlacement = ((popMidY > refMidY ? 'bottom' : 'top') +
				suffix) as PopoverPlacement;
		} else {
			const popMidX = (popRect.left + popRect.right) / 2;
			const refMidX = (refRect.left + refRect.right) / 2;
			realPlacement = ((popMidX > refMidX ? 'right' : 'left') +
				suffix) as PopoverPlacement;
		}

		transformOrigin = getTransformOrigin(realPlacement);

		const [edgeStart, edgeEnd] = edgeCornersFor(realPlacement);

		// Arrow positioning — keep the arrow base on the straight segment of the
		// edge (clear of the rounded corners): point at the target → shift the
		// popover so the arrow can point while clearing the corner → flatten the
		// invaded corner when the viewport blocks shifting.
		if (arrow && !transparent) {
			const startRadius = readCornerRadius(edgeStart);
			const endRadius = readCornerRadius(edgeEnd);
			if (realPlacement.startsWith('top') || realPlacement.startsWith('bottom')) {
				// Subtract the current shift so the math always works from the
				// popover's unshifted (CSS anchor) position and stays stable.
				const baseLeft = popRect.left - shiftX;
				const resolved = resolveArrowAlongEdge(
					refRect.left + refRect.width / 2 - baseLeft,
					popRect.width,
					startRadius,
					endRadius,
					VIEWPORT_MARGIN - baseLeft,
					window.innerWidth - VIEWPORT_MARGIN - popRect.width - baseLeft,
				);
				shiftX = resolved.shift;
				shiftY = 0;
				// The arrow element is ARROW_SIZE / 2 wide; offset so its visual
				// center (the tip) sits at the resolved coordinate.
				arrowX = `${resolved.arrow - ARROW_SIZE / 4}px`;
				arrowY = '';
				cornerRadii = cornerOverrides(
					edgeStart,
					edgeEnd,
					resolved.start_radius,
					resolved.end_radius,
				);
			} else {
				const baseTop = popRect.top - shiftY;
				const resolved = resolveArrowAlongEdge(
					refRect.top + refRect.height / 2 - baseTop,
					popRect.height,
					startRadius,
					endRadius,
					VIEWPORT_MARGIN - baseTop,
					window.innerHeight - VIEWPORT_MARGIN - popRect.height - baseTop,
				);
				shiftY = resolved.shift;
				shiftX = 0;
				arrowY = `${resolved.arrow - ARROW_SIZE / 4}px`;
				arrowX = '';
				cornerRadii = cornerOverrides(
					edgeStart,
					edgeEnd,
					resolved.start_radius,
					resolved.end_radius,
				);
			}
		}

		// Hit box for hover popovers
		if (open_on_hover && !untrack(() => forcedOpened)) {
			const borderRadius = Math.max(
				readCornerRadius(edgeStart),
				readCornerRadius(edgeEnd),
			);
			if (realPlacement.startsWith('top') || realPlacement.startsWith('bottom')) {
				hitBoxLengthZ = Math.min(16, refRect.height / 2) + anchorOffset;
				hitBoxLength = popoverElement.clientWidth;
				hitBoxLengthA = popoverElement.clientWidth - borderRadius * 2;
				hitBoxLengthB = refRect.width;
				hitBoxOffsetA = borderRadius;
				hitBoxOffsetB = refRect.x - popRect.x;
			} else {
				hitBoxLengthZ = Math.min(16, refRect.width / 2) + anchorOffset;
				hitBoxLength = popoverElement.clientHeight;
				hitBoxLengthA = popoverElement.clientHeight - borderRadius * 2;
				hitBoxLengthB = refRect.height;
				hitBoxOffsetA = borderRadius;
				hitBoxOffsetB = refRect.y - popRect.y;
			}
		}

		positioned = true;
	}

	/** Position calculation for virtual reference (context menu) — one-shot, no autoUpdate */
	function calculateVirtualPosition() {
		if (!popoverElement || typeof x !== 'number' || typeof y !== 'number') return;

		const popRect = popoverElement.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let calcX = x;
		let calcY = y + anchorOffset;
		let calcPlacement = placement;

		// Flip vertically if overflows bottom
		if (calcY + popRect.height > vh && y - popRect.height - anchorOffset > 0) {
			calcY = y - popRect.height - anchorOffset;
			const suffix = placement.includes('-') ? '-' + placement.split('-')[1] : '';
			calcPlacement = ('top' + suffix) as PopoverPlacement;
		}

		// Clamp to viewport
		calcX = Math.max(
			VIEWPORT_MARGIN,
			Math.min(calcX, vw - popRect.width - VIEWPORT_MARGIN),
		);
		calcY = Math.max(
			VIEWPORT_MARGIN,
			Math.min(calcY, vh - popRect.height - VIEWPORT_MARGIN),
		);

		realPlacement = calcPlacement;
		transformOrigin = getTransformOrigin(calcPlacement);

		// Arrow positioning — same clamp → shift → corner-flatten cascade as the
		// real-element path, except the shift is folded straight into the
		// popover's position (this path is one-shot, no translate needed).
		if (arrow && !transparent) {
			const [edgeStart, edgeEnd] = edgeCornersFor(realPlacement);
			if (realPlacement.startsWith('top') || realPlacement.startsWith('bottom')) {
				const resolved = resolveArrowAlongEdge(
					x - calcX,
					popRect.width,
					readCornerRadius(edgeStart),
					readCornerRadius(edgeEnd),
					VIEWPORT_MARGIN - calcX,
					vw - VIEWPORT_MARGIN - popRect.width - calcX,
				);
				calcX += resolved.shift;
				arrowX = `${resolved.arrow - ARROW_SIZE / 4}px`;
				arrowY = '';
				cornerRadii = cornerOverrides(
					edgeStart,
					edgeEnd,
					resolved.start_radius,
					resolved.end_radius,
				);
			} else {
				const resolved = resolveArrowAlongEdge(
					y - calcY,
					popRect.height,
					readCornerRadius(edgeStart),
					readCornerRadius(edgeEnd),
					VIEWPORT_MARGIN - calcY,
					vh - VIEWPORT_MARGIN - popRect.height - calcY,
				);
				calcY += resolved.shift;
				arrowY = `${resolved.arrow - ARROW_SIZE / 4}px`;
				arrowX = '';
				cornerRadii = cornerOverrides(
					edgeStart,
					edgeEnd,
					resolved.start_radius,
					resolved.end_radius,
				);
			}
		}

		left = `${calcX}px`;
		top = `${calcY}px`;
		positioned = true;
	}

	// Positioning effect — detects actual placement for arrow/transform-origin/hit-box
	$effect(() => {
		if (!shown || !popoverElement) return;
		// oxlint-disable-next-line no-unused-expressions
		placement; // re-run when placement changes (so the arrow location gets update dynamically)

		if (ref_element) {
			// Real element path: CSS anchor positioning handles layout, we just detect the result
			const el = ref_element;
			const popEl = popoverElement;
			const onUpdate = () => untrack(() => detectAndUpdate());
			const rafId = requestAnimationFrame(onUpdate);
			// Re-measure once the intro scale transition settles — rects read while
			// the popover is still scaling are smaller than the final layout box.
			const settleTimeout = setTimeout(onUpdate, TRANSITION_IN_DURATION + 50);

			window.addEventListener('scroll', onUpdate, true);
			window.addEventListener('resize', onUpdate);

			const resizeObserver = new ResizeObserver(onUpdate);
			resizeObserver.observe(popEl);
			resizeObserver.observe(el);

			return () => {
				cancelAnimationFrame(rafId);
				clearTimeout(settleTimeout);
				window.removeEventListener('scroll', onUpdate, true);
				window.removeEventListener('resize', onUpdate);
				resizeObserver.disconnect();
			};
		} else {
			// Virtual reference path (context menu) — one-shot JS positioning
			untrack(() => calculateVirtualPosition());
		}
	});

	// Close the popover when clicked outside (fallback for when focus-trap doesn't activate)
	$effect(() => {
		if (!opened || !close_on_outside_click) return;
		function onDocumentPointerDown(e: PointerEvent) {
			if (!popoverElement || !opened) return;
			let el = e.target as HTMLElement | null | undefined;
			while (el) {
				if (
					el === popoverElement ||
					el === ref_element ||
					(el.classList.contains('portal') && el.id === 'portal_' + id)
				) {
					return;
				}
				el = el.parentElement;
			}
			let highestPopoverIndex = -1;
			document.querySelectorAll('[data-popover-index]').forEach((el) => {
				highestPopoverIndex = Math.max(
					highestPopoverIndex,
					+((el as HTMLElement).dataset.popoverIndex || '0'),
				);
			});
			if (highestPopoverIndex <= popoverIndex) {
				opened = false;
				forcedOpened = false;
			}
		}
		// Delay adding the listener to avoid catching the click that opened the popover
		const timeout = setTimeout(() => {
			document.addEventListener('pointerdown', onDocumentPointerDown);
		}, 0);
		return () => {
			clearTimeout(timeout);
			document.removeEventListener('pointerdown', onDocumentPointerDown);
		};
	});

	// Handle the popover opening and closing when the ref element is hovered over
	let stopMouseDownListener = () => {};
	let stopMouseMoveListener = () => {};
	let refListeners: Array<() => void> = [];
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	function stopRefListeners() {
		refListeners.forEach((destroy) => destroy());
		refListeners = [];
	}
	function stopListeners() {
		stopRefListeners();
		stopMouseDownListener();
		stopMouseMoveListener();
	}
	let willOpen = false;

	/** Handles when a mouse moves (after the popoever has been opened on hover). Used to close popover when moved off */
	function onMouseMove(e: MouseEvent) {
		if (!ref_element) return;
		if (untrack(() => forcedOpened)) return stopMouseMoveListener();
		let el = e.target as HTMLElement | null | undefined;
		let isHoveringOverPopover = false;
		if (el && !el.classList.contains('popover-hit-box')) {
			while (el) {
				if (
					el === popoverElement ||
					el === ref_element ||
					el.classList.contains('popover-hit-shape')
				) {
					isHoveringOverPopover = true;
					break;
				}
				el = el?.parentElement;
			}
		}
		if (isHoveringOverPopover) {
			if (!willOpen) willOpen = true;
			return;
		}
		if (untrack(() => !opened)) portalOpened = false;
		opened = false;
		willOpen = false;
		stopMouseMoveListener();
		clearTimeout(debounceTimer);
	}

	/** Handles when the user clicks outside the popover (and thus is should close) */
	function onPointerDown(e: MouseEvent) {
		let el = e.target as HTMLElement | null | undefined;
		let isOutsideClick = true;
		while (el) {
			if (
				el === popoverElement ||
				el === ref_element ||
				(el.classList.contains('portal') && el.id === 'portal_' + id)
			) {
				isOutsideClick = false;
				break;
			}
			el = el?.parentElement;
		}
		let highestPopoverIndex = -1;
		document.querySelectorAll('[data-popover-index]').forEach((el) => {
			highestPopoverIndex = Math.max(
				highestPopoverIndex,
				+((el as HTMLElement).dataset.popoverIndex || '0'),
			);
		});
		if (isOutsideClick && highestPopoverIndex <= popoverIndex) {
			opened = false;
			willOpen = false;
			forcedOpened = false;
			stopMouseDownListener();
		}
	}

	/** Handles when the mouse enters the popover's target/trigger element. Used to open the popover on hover */
	function onRefElementMouseEnter(e: MouseEvent) {
		willOpen = false;
		clearTimeout(debounceTimer);
		if (untrack(() => forcedOpened)) return stopMouseMoveListener();
		if (!ref_element) {
			opened = false;
			forcedOpened = false;
			return;
		}
		debounceTimer = setTimeout(() => {
			if (untrack(() => forcedOpened)) return;
			if (untrack(() => opened)) return;
			if (!willOpen) return;
			opened = true;
		}, hover_delay);
		portalOpened = true;
		willOpen = true;
		document.addEventListener('mousemove', onMouseMove);
		stopMouseMoveListener = () => {
			document.removeEventListener('mousemove', onMouseMove);
		};
	}

	/**
	 * Prevents the pointer down event from propagating
	 * This prevents other mousedown events like the ripple effect from firing on a parent element
	 */
	function onRefElementPointerUp(e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	/** Handles when the user clicks on the popover's target/trigger element. Used to force open the popover */
	function onRefElementClick(e: MouseEvent) {
		let el = e.target as HTMLElement | null | undefined;

		// Check if the hit box shape was clicked. If so, we need to check if the click would have hit the trigger element
		if (el && el.classList.contains('popover-hit-shape')) {
			el.style.pointerEvents = 'none';
			let triggerEl = document.elementFromPoint(e.clientX, e.clientY);
			let isRefElement = false;
			while (triggerEl) {
				if (triggerEl === ref_element) {
					isRefElement = true;
					break;
				}
				triggerEl = triggerEl.parentElement;
			}
			el.style.removeProperty('pointer-events');
			if (!isRefElement) return;
		}
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();

		if (untrack(() => opened) && untrack(() => forcedOpened)) {
			willOpen = false;
			opened = false;
			forcedOpened = false;
			stopMouseDownListener();
			return;
		}
		forcedOpened = true;
		willOpen = true;
		opened = true;
		document.addEventListener('pointerdown', onPointerDown);
		stopMouseDownListener = () => {
			document.removeEventListener('pointerdown', onPointerDown);
		};
	}

	/** Handles when the user presses enter/escape when the trigger element is focused */
	function onRefElementKeyUp(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			opened = false;
			forcedOpened = false;
			e.preventDefault();
			e.stopPropagation();
		}
		// We should ignore events that are on button like elements
		// because they will trigger the click event (which will toggle the popover)
		// If this also runs, it will toggle the popover twice
		const isButtonLike =
			e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement;
		if (!isButtonLike && (e.key === 'Enter' || e.key === ' ')) {
			if (untrack(() => forcedOpened)) {
				opened = !untrack(() => opened);
				forcedOpened = !untrack(() => opened);
			} else {
				forcedOpened = true;
			}
			e.preventDefault();
			e.stopPropagation();
		}
	}

	/** Handles when the trigger element is no longer in focus and thus should be closed (if open) */
	function onRefElementBlur(e: FocusEvent) {
		if (!ref_element) return;
		ref_element.removeEventListener('blur', onRefElementBlur);
		ref_element.removeEventListener('keyup', onRefElementKeyUp);
		if (untrack(() => forcedOpened)) return;
		if (!untrack(() => opened)) return;
		opened = false;
	}

	/** Handles when the trigger element is focused. If so, the panel will be opened if open_on_focus is true */
	function onRefElementFocus(e: FocusEvent) {
		if (!ref_element) return;
		ref_element.addEventListener('blur', onRefElementBlur);
		if (close_on_escape_key) {
			ref_element.addEventListener('keyup', onRefElementKeyUp);
		}
		if (untrack(() => forcedOpened)) return;
		if (untrack(() => opened)) return;
		portalOpened = true;
		tick().then(() => {
			// Delay opening the popover by a frame so the the animation in effect will work
			opened = true;
		});
	}

	/** Handles when the user presses escape when the portal element is focused */
	function onPortalElementKeyUp(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			opened = false;
			forcedOpened = false;
			e.preventDefault();
			e.stopPropagation();
		}
	}

	// Add event listeners when the ref_element is set
	$effect(() => {
		if (!ref_element || (!open_on_hover && !open_on_click && !open_on_focus)) return;
		stopListeners();
		if (open_on_hover) {
			ref_element.addEventListener('mouseenter', onRefElementMouseEnter);
		} else {
			ref_element.removeEventListener('mouseenter', onRefElementMouseEnter);
		}
		if (open_on_click) {
			ref_element.addEventListener('click', onRefElementClick);
			ref_element.addEventListener('pointerup', onRefElementPointerUp);
		} else {
			ref_element.removeEventListener('click', onRefElementClick);
		}
		if (open_on_focus) {
			ref_element.addEventListener('focus', onRefElementFocus);
			ref_element.tabIndex = 0;
		} else {
			if (close_on_escape_key) {
				ref_element.addEventListener('keyup', onRefElementKeyUp);
			} else {
				ref_element.removeEventListener('keyup', onRefElementKeyUp);
			}
			ref_element.removeEventListener('focus', onRefElementFocus);
			ref_element.removeAttribute('tabindex');
		}
		refListeners.push(
			() => ref_element?.removeEventListener('mouseenter', onRefElementMouseEnter),
			() => ref_element?.removeEventListener('click', onRefElementClick),
			() => ref_element?.removeEventListener('pointerup', onRefElementPointerUp),
			() => ref_element?.removeEventListener('focus', onRefElementFocus),
			() => ref_element?.removeEventListener('blur', onRefElementBlur),
			() => ref_element?.removeEventListener('keyup', onRefElementKeyUp),
		);
		return () => stopListeners();
	});

	// Remove any remaining document listeners and pending timers on unmount
	$effect(() => {
		return () => {
			clearTimeout(portalOpenedTimeout);
			clearTimeout(debounceTimer);
			stopListeners();
		};
	});

	$effect.pre(() => {
		if (!portalOpened || !shown) return;
		let highestIndex = -1;
		document.querySelectorAll('[data-popover-index]').forEach((el) => {
			highestIndex = Math.max(
				highestIndex,
				+((el as HTMLElement).dataset.popoverIndex || '0'),
			);
		});
		popoverIndex = highestIndex + 1;
	});
</script>

{#snippet popover()}
	{#if shown}
		<div
			class="popover {class_name}"
			class:positioned
			class:transparent
			class:dense
			class:comfortable
			bind:this={popoverElement}
			style="{style}; {positionStyle}"
			style:--popover-radius={radius}
			style:transform-origin={transformOrigin}
			style:translate={shiftX || shiftY ? `${shiftX}px ${shiftY}px` : undefined}
			style:border-top-left-radius={cornerRadii.tl}
			style:border-top-right-radius={cornerRadii.tr}
			style:border-bottom-right-radius={cornerRadii.br}
			style:border-bottom-left-radius={cornerRadii.bl}
			{id}
			data-popover-index={popoverIndex}
			role="presentation"
			{@attach focusTrap({
				enabled: !open_on_focus,
				initialFocus: disable_initial_focus ? false : undefined,
				clickOutsideDeactivates: (e) => {
					if ((e as MouseEvent).button === 2) return false; // Ignore right clicks
					if (!close_on_outside_click) return false;
					if (open_on_click) return false;
					let el = e.target as HTMLElement | null | undefined;
					while (el) {
						if ((ref_element && el === ref_element) || el === popoverElement)
							return false;
						el = el.parentElement;
					}
					return true;
				},
				escapeDeactivates: false,
				returnFocusOnDeactivate: true,
				allowOutsideClick: true,
				onDeactivate: () => {
					if (opened) opened = false;
					if (forcedOpened) forcedOpened = false;
					stopMouseDownListener();
				},
			})}
			onkeyup={onPortalElementKeyUp}
			onclick={(e) => {
				if (!close_on_inside_click) return;
				let element = e.target as HTMLElement;
				let isButtonLike = false;
				while (element) {
					if (element.tagName === 'BUTTON' || element.tagName === 'A') {
						isButtonLike = true;
						break;
					}
					element = element.parentElement as HTMLElement;
				}
				if (isButtonLike && opened) opened = false;
			}}
			in:scale={{ start: 0.7, easing: backOut, duration: TRANSITION_IN_DURATION }}
			out:scale={{ start: 0.7, easing: backIn, duration: TRANSITION_OUT_DURATION }}
			onoutroend={() => {
				if (ref_element) (ref_element.style as any).anchorName = '';
			}}>
			<div class="content" {@attach scrollbar()}>
				{#if children}{@render children()}{/if}
			</div>
			{#if arrow}
				<div
					class="arrow"
					class:bottom={realPlacement.startsWith('top')}
					class:top={realPlacement.startsWith('bottom')}
					class:left={realPlacement.startsWith('right')}
					class:right={realPlacement.startsWith('left')}
					bind:this={arrowElement}
					style:--arrow-size={`${ARROW_SIZE}px`}
					style:left={arrowX}
					style:top={arrowY}>
				</div>
			{/if}
			{#if open_on_hover && !forcedOpened}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="popover-hit-box"
					width={realPlacement.startsWith('bottom') || realPlacement.startsWith('top')
						? hitBoxLength
						: hitBoxLengthZ}
					height={realPlacement.startsWith('bottom') || realPlacement.startsWith('top')
						? hitBoxLengthZ
						: hitBoxLength}
					viewBox={realPlacement.startsWith('bottom') || realPlacement.startsWith('top')
						? `0 0 ${hitBoxLength} ${hitBoxLengthZ}`
						: `0 0 ${hitBoxLengthZ} ${hitBoxLength}`}
					style:pointer-events="none"
					style:position="absolute"
					style:top={realPlacement.startsWith('top')
						? '100%'
						: realPlacement.startsWith('bottom')
							? ''
							: '0px'}
					style:bottom={realPlacement.startsWith('bottom') ? '100%' : ''}
					style:left={realPlacement.startsWith('left')
						? '100%'
						: realPlacement.startsWith('right')
							? ''
							: '0px'}
					style:right={realPlacement.startsWith('right') ? '100%' : ''}>
					<path
						class="popover-hit-shape"
						onclick={onRefElementClick}
						role="presentation"
						d={hitBoxShape}
						fill="transparent">
					</path>
				</svg>
			{/if}
		</div>
	{/if}
{/snippet}

{#if strategy === 'fixed'}
	{#if portalOpened}
		<Portal id="portal_{id}">{@render popover()}</Portal>
	{/if}
{:else}
	{@render popover()}
{/if}

<style>
	.popover-hit-box {
		pointer-events: none;
	}
	.popover-hit-shape {
		pointer-events: all;
	}
	.popover {
		--color-bg: var(--color-surface);
		--layer: var(--layer-popover);
		--easing: var(--ease-spring);
		/* Clamp the radius so an over-rounded --popover-radius (or --radius-xl)
		   can't turn the panel into a blob — see --radius-cap. The corner
		   flattening reads the computed corner radius, so it picks this up too. */
		--_radius: min(var(--popover-radius, var(--radius-xl)), var(--radius-cap, 40px));
		z-index: var(--layer);
		background-color: var(--color-bg);
		border: 1px solid var(--color-border, transparent);
		border-radius: var(--_radius);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--_radius) * var(--squircle-ratio, 2));
		}
		/* Light mode: a real drop shadow lifts the panel off the page. Dark mode:
		 * the --shadow-md token resolves to transparent (dark shadows are
		 * invisible on dark surfaces), so the border above is what separates the
		 * panel from the page. */
		box-shadow: var(--shadow-md);
		max-width: calc(100vw - 1rem);
		max-height: calc(100vh - 1rem);
		/* Smooth the dynamic corner flattening (arrow-near-corner fallback) so a
		 * radius change while open never pops. Everything else stays untransitioned. */
		transition: border-radius 150ms ease;
		overflow: visible;
		.content {
			padding: 1rem 1.25rem;
			overflow: auto;
			overscroll-behavior: contain;
			max-height: inherit;
			max-width: inherit;
			border-radius: inherit;
			@supports (corner-shape: squircle) {
				corner-shape: inherit;
			}
		}
		&.dense .content {
			padding: 0.5rem 0.75rem;
		}
		&.comfortable .content {
			padding: 1.5rem 2rem;
		}
		/* When the popover hosts a top-level list, drop the inner padding so its
		 * items run edge-to-edge (a list reads as the menu, not content inside a
		 * padded card). The list comes from another component → matched with
		 * :global. */
		&:has(> .content > :global(ul.list:only-child)) .content {
			padding: 0;
		}
		/* If that list provides its OWN surface (`filled`/`outline`), also drop
		 * the popover's background + border so the list surface takes over
		 * (otherwise a double surface). A plain (transparent) list instead keeps
		 * the popover's surface as its background. */
		&:has(> .content > :global(ul.list:is(.filled, .outline):only-child)) {
			background-color: transparent;
			border-color: transparent;
		}
		/* Transparent panel: hand the surface entirely to the inner content. */
		&.transparent {
			background-color: transparent;
			border-color: transparent;
			box-shadow: none;
		}
		&.transparent .content {
			padding: 0;
		}
		&.transparent .arrow {
			display: none;
		}
		.arrow {
			position: absolute;
			pointer-events: none;
			background-color: var(--color-bg);
			width: calc(var(--arrow-size) / 2);
			height: calc(var(--arrow-size) / 2);
			top: calc(var(--arrow-size) / -2);
			/* Stroke the arrow's outline so it carries the same border as the
			 * panel — otherwise, with no shadow and a surface color near the page
			 * color (especially in dark mode), the arrow is invisible. Three 1px
			 * drop-shadows trace the two slanted sides + the rounded tip/shoulders
			 * (built by the ::before/::after fillets, which the filter includes);
			 * the base needs no stroke since it sits on the panel's own border.
			 * Directions are in the arrow's local "points up" space — the
			 * rotate() on .bottom/.left/.right carries them to the right edges. */
			filter: drop-shadow(0 -1px 0 var(--color-border, transparent))
				drop-shadow(-1px 0 0 var(--color-border, transparent))
				drop-shadow(1px 0 0 var(--color-border, transparent));
			/* The fillets reach below the panel edge (into the panel) to blend the
			 * shoulders; the filter would stroke the side-edges of that hidden
			 * extension, drawing a border line across the arrow's mouth ("floor").
			 * Clip everything past the base (`bottom: 0` = the panel edge) so the
			 * mouth stays open and the panel's own border draws the shoulders. The
			 * negative insets leave the tip, slants, and stroke unclipped. */
			clip-path: inset(-100px -100px 0 -100px);
			&.bottom {
				top: 100%;
				transform: rotate(180deg);
			}
			&.left {
				right: 100%;
				transform: rotate(270deg);
			}
			&.right {
				left: 100%;
				transform: rotate(90deg);
			}
			&::before,
			&::after {
				content: '';
				position: absolute;
				height: var(--arrow-size);
				width: var(--arrow-size);
				bottom: 0;
			}

			&::after {
				right: calc(var(--arrow-size) * -1 + 3px);
				border-radius: 0 0 0 var(--arrow-size);
				box-shadow: min(-2px, calc(var(--arrow-size) / -2 + 8px)) 8px 0 0 var(--color-bg);
			}

			&::before {
				left: calc(var(--arrow-size) * -1 + 3px);
				border-radius: 0px 0px var(--arrow-size) 0;
				box-shadow: max(2px, calc(var(--arrow-size) / 2 - 8px)) 8px 0 0 var(--color-bg);
			}
		}
	}
</style>
