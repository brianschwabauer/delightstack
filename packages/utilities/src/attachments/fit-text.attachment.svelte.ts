import type { Attachment } from 'svelte/attachments';

export interface FitTextOptions {
	/** The minimum font size (in px). @default 10 */
	min?: number;

	/** The maximum font size (in px). @default 100 */
	max?: number;

	/** How 'balanced' the text should be. A ratio of 1 means each line of text is the same width @default 1 */
	balanceRatio?: number;

	/** How text should be balanced - using padding or margin. @default padding */
	balanceStrategy?: 'padding' | 'margin';

	/**
	 * When balancing the text, how should the block of text be aligned?
	 * This is different than text-align because this moves the block of text via padding
	 * @default 'left'
	 */
	align?: 'left' | 'center' | 'right';

	/** Prevents the text from wrapping (makes it a single line) @default false */
	disableWrap?: boolean;

	/** Disables the text balancing that makes each line approximately the same width @default false */
	disableBalance?: boolean;

	/** Disables the font resizing @default false */
	disableResize?: boolean;

	/**
	 * The class that will be added to the element when the text has been fit/resized/balanced @default 'fit'
	 * This can be used to animate the text - EX animate the opacity of the text to fix the SSR 'blink' in resizing
	 */
	class?: string;

	/** Called when the text has been fit to the container */
	onfit?: () => void;

	/** A string that when updated to a unique value will cause the text to be re-fitted. This is useful for force-refitting (like on font change) */
	key?: string;
}

/**
 * Resizes & balances the text in the given element to fit the element's bounds
 * @example
 * ```svelte
 * <div {@attach fitText()}>
 * ```
 */
export function fitText(options?: Partial<FitTextOptions>): Attachment<HTMLElement> {
	let min = options?.min ?? 10;
	let max = options?.max ?? 100;
	let disableWrap = options?.disableWrap ?? false;
	let disableBalance = options?.disableBalance ?? false;
	let disableResize = options?.disableResize ?? false;
	let balanceRatio = options?.balanceRatio ?? 1;
	let balanceStrategy = options?.balanceStrategy ?? 'padding';
	let align = options?.align ?? 'left';
	let className = options?.class ?? 'fit';
	let eventEmitted = false;
	let updating = false;

	// Resize and balance the text when the element is resized or the content is changed
	const update = (el: HTMLElement): void => {
		if (updating || (disableBalance && disableResize)) return;
		updating = true;
		const style = getComputedStyle(el);
		if (!el.style.position) el.style.position = 'relative';
		if (disableWrap && el.style.whiteSpace !== 'nowrap') {
			el.style.whiteSpace = 'nowrap';
		}
		if (!disableWrap && el.style.whiteSpace === 'nowrap') {
			el.style.removeProperty('white-space');
		}

		// Add a temporary element to measure the text size
		el.querySelector('.fit-text-resizer')?.remove();
		const resizeEl = document.createElement('div');
		resizeEl.ariaHidden = 'true';
		resizeEl.className = 'fit-text-resizer';
		resizeEl.style.position = 'absolute';
		resizeEl.style.inset = '0px';
		resizeEl.style.opacity = '0';
		resizeEl.style.pointerEvents = 'none';
		resizeEl.style.whiteSpace = style.whiteSpace;
		resizeEl.style.fontFamily = style.fontFamily;
		const heightFinderEl = document.createElement('div');
		heightFinderEl.className = 'fit-text-height-finder';
		heightFinderEl.style.display = 'inline-flex';
		heightFinderEl.style.fontFamily = style.fontFamily;
		heightFinderEl.textContent = el.textContent ?? '';
		resizeEl.appendChild(heightFinderEl);
		el.appendChild(resizeEl);

		// Temporarily remove the padding/margin to get the correct width
		if (!disableBalance) {
			if (balanceStrategy === 'padding') {
				el.style.paddingLeft = '0px';
				el.style.paddingRight = '0px';
			} else if (balanceStrategy === 'margin') {
				el.style.marginLeft = '0px';
				el.style.marginRight = '0px';
			}
		}

		const rawText = resizeEl.textContent ?? '';
		// split on breakable whitespace only (preserves NBSP)
		const tokens = rawText.split(/[ \t\r\n\f\v\u200B\u00AD]+/).filter(Boolean);
		// heuristic: only run per-token measuring when necessary
		const needsTokenCheck = /([\u00A0]|\S){10,}/.test(rawText);

		// helper that checks overflow at the current font-size applied to resizeEl
		function isOverflow(el: HTMLElement): boolean {
			// vertical overflow is immediate
			if (el.scrollHeight > el.clientHeight) return true;

			// cheap horizontal check if text looks normal
			if (!needsTokenCheck) return el.scrollWidth > el.clientWidth;

			// token-aware check: measure each token inside resizeEl so it inherits correct styles
			const measurer = document.createElement('span');
			measurer.style.display = 'inline-block';
			measurer.style.whiteSpace = 'nowrap';
			measurer.style.visibility = 'hidden';
			measurer.style.pointerEvents = 'none';
			// don't let measurer affect layout
			measurer.style.position = 'absolute';
			measurer.style.left = '-9999px';

			// copy font styles so measurement matches exactly
			const cs = getComputedStyle(el);
			measurer.style.fontFamily = cs.fontFamily;
			measurer.style.fontWeight = cs.fontWeight;
			measurer.style.lineHeight = cs.lineHeight;
			// note: fontSize will be whatever is currently applied to el (inheritance)

			el.appendChild(measurer);

			// measure each token; if any token width > container width -> overflow
			const containerW = el.clientWidth;
			for (const t of tokens) {
				measurer.textContent = t;
				if (measurer.scrollWidth > containerW) {
					measurer.remove();
					return true;
				}
			}

			measurer.remove();
			// fallback to whole-content check (should be false if tokens all fit)
			return el.scrollWidth > containerW;
		}

		// Determine the best font size and apply it to the element
		let low = min;
		let high = max;
		let middle: number;
		let size = low;
		if (!disableResize) {
			// Binary search for highest best fit
			while (low <= high) {
				middle = (high + low) >> 1;
				el.style.fontSize = `${middle}px`;
				if (isOverflow(resizeEl)) {
					high = middle - 1;
				} else {
					size = middle;
					low = middle + 1;
				}
			}
			el.style.fontSize = `${size}px`;
			resizeEl.style.fontSize = `${size}px`;
		}
		resizeEl.style.lineHeight = style.lineHeight;
		resizeEl.style.fontFamily = style.fontFamily;
		resizeEl.style.fontWeight = style.fontWeight;

		// Determine the padding/margin to balance the text on the current number of lines
		if (!disableBalance && !disableWrap) {
			const width = resizeEl.clientWidth;
			const height = resizeEl.scrollHeight;

			// Synchronously do binary search and calculate the layout
			low = width / 2;
			high = width;
			let changedScrollHeight = false;
			while (low + 1 < high) {
				middle = ~~((low + high) / 2);
				resizeEl.style.paddingRight = `${width - middle}px`;
				if (resizeEl.scrollHeight === height) {
					high = middle;
				} else {
					changedScrollHeight = true;
					low = middle;
				}
			}

			// If the scroll height didn't change, that means the text is already balanced (or can't text wrap)
			if (!changedScrollHeight) {
				high = width;
			}

			const lineHeight = parseInt(getComputedStyle(el).lineHeight);
			if (height < lineHeight * 1.5) {
				if (balanceStrategy === 'padding') {
					el.style.removeProperty('padding-left');
					el.style.removeProperty('padding-right');
				} else if (balanceStrategy === 'margin') {
					el.style.removeProperty('margin-left');
					el.style.removeProperty('margin-right');
				}
				if (align === 'center') el.style.textAlign = 'center';
				if (align === 'right') el.style.textAlign = 'right';
				resizeEl.style.paddingRight = '0px';
			} else {
				// Update the wrapper width
				const targetWidth = high * balanceRatio + width * (1 - balanceRatio);
				const padding = width - targetWidth;
				if (padding <= 0) {
					if (balanceStrategy === 'padding') {
						el.style.removeProperty('padding-left');
						el.style.removeProperty('padding-right');
					} else if (balanceStrategy === 'margin') {
						el.style.removeProperty('margin-left');
						el.style.removeProperty('margin-right');
					}
					resizeEl.style.paddingRight = '0px';
				} else {
					let paddingLeft = '0';
					let paddingRight = `${padding}px`;
					if (align === 'right') {
						paddingLeft = `${padding}px`;
						paddingRight = `0`;
					} else if (align === 'center') {
						paddingLeft = `${padding / 2}px`;
						paddingRight = `${padding / 2}px`;
					}
					if (balanceStrategy === 'padding') {
						el.style.paddingLeft = paddingLeft;
						el.style.paddingRight = paddingRight;
					} else if (balanceStrategy === 'margin') {
						el.style.marginLeft = paddingLeft;
						el.style.marginRight = paddingRight;
					}
					resizeEl.style.paddingRight = width - targetWidth + 'px';
				}
			}
		}

		const wrappedTextHeight = heightFinderEl?.offsetHeight || 0;
		el.style.setProperty('--text-height', `${wrappedTextHeight}px`);
		resizeEl.remove();

		// Add the class - indicating that the text has been resized and balanced
		if (!el.classList.contains(className)) {
			setTimeout(() => el.classList.add(className), 0);
		}
		if (!eventEmitted) {
			eventEmitted = true;
			setTimeout(() => options?.onfit?.(), 0);
		}
		setTimeout(() => (updating = false), 5);
	};

	let mutationObserver: MutationObserver | undefined;
	let resizeObserver: ResizeObserver | undefined;

	return (el: HTMLElement) => {
		min = options?.min ?? min ?? 10;
		max = options?.max ?? max ?? 100;
		disableWrap = options?.disableWrap ?? disableWrap ?? false;
		disableBalance = options?.disableBalance ?? disableBalance ?? false;
		disableResize = options?.disableResize ?? disableResize ?? false;
		balanceRatio = options?.balanceRatio ?? balanceRatio ?? 1;
		balanceStrategy = options?.balanceStrategy ?? 'padding';
		align = options?.align ?? align ?? 'left';
		className = options?.class ?? className ?? 'fit';
		if (!mutationObserver) {
			mutationObserver = new MutationObserver(() => update(el));
			mutationObserver.observe(el, {
				subtree: true,
				characterData: true,
				attributes: false,
				childList: false,
			});
		}
		if (!resizeObserver) {
			resizeObserver = new ResizeObserver(() => update(el));
			resizeObserver.observe(el);
		}
		update(el);
		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	};
}
