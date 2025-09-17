import type { Attachment } from 'svelte/attachments';

export interface TruncateTextOptions {
	/** The number of characters to limit the text to. If not provided, it will truncate based on container size */
	limit?: number;

	/** Where the truncation should take place in the string. @default 'middle' */
	location?: 'start' | 'middle' | 'end';
}

/** Truncates the text in an element so it fits without wrapping. */
export function truncateText(
	options?: Partial<TruncateTextOptions> | undefined,
): Attachment<HTMLElement> {
	return (el: HTMLElement) => {
		const parent = el.parentElement;
		if (!parent) return;
		const originalText = el.innerHTML;
		if (el.ariaLabel === null) el.ariaLabel = originalText;
		const convertToNumber = (px: string) => {
			if (!px.length) return 0;
			return +px.slice(0, -2);
		};
		function truncate() {
			if (options?.limit) {
				if (options?.location === 'start') {
					el.innerHTML = `...${originalText.slice(-options.limit)}`;
				} else if (options?.location === 'end') {
					el.innerHTML = `${originalText.slice(0, options.limit)}...`;
				} else {
					const start = originalText.slice(0, options.limit / 2);
					const end = originalText.slice(-options.limit / 2);
					el.innerHTML = `${start}...${end}`;
				}
				return;
			}
			if (!parent) return;
			const leftPad = convertToNumber(
				getComputedStyle(parent).getPropertyValue('padding-left'),
			);
			const rightPad = convertToNumber(
				getComputedStyle(parent).getPropertyValue('padding-right'),
			);
			const parentWidth = parent.offsetWidth - leftPad - rightPad;
			for (let i = 0; i < originalText.length; i++) {
				if (el.scrollWidth > parentWidth) {
					if (options?.location === 'start') {
						el.innerHTML = `...${originalText.slice(-originalText.length + i)}`;
					} else if (options?.location === 'end') {
						el.innerHTML = `${originalText.slice(0, originalText.length - i)}...`;
					} else {
						const start = originalText.slice(0, originalText.length / 2 - i);
						const end = originalText.slice(-(originalText.length / 2) + i);
						el.innerHTML = `${start}...${end}`;
					}
				} else {
					el.innerHTML = originalText;
				}
				if (el.scrollWidth <= parentWidth) break;
			}
		}

		truncate();
		const r = new ResizeObserver(truncate);
		r.observe(parent);
		return () => r.disconnect();
	};
}
