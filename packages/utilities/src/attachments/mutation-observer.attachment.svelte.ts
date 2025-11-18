import type { Attachment } from 'svelte/attachments';

/**
 * Observers when an element's content changes and calls the callback function on every mutation
 * @example
 * ```svelte
 * {@attach mutationObserver({
 * 		onmutate: (records: MutationRecord[]) => console.log(`Element's children mutated:`, records),
 * })}
 */
export function mutationObserver({
	onmutate,
	debounce,
}: {
	onmutate: (records: MutationRecord[]) => void;
	debounce?: number;
}): Attachment<HTMLElement> {
	let timer: ReturnType<typeof setTimeout> | undefined = undefined;
	return (el: HTMLElement) => {
		const observer = new MutationObserver((entries) => {
			if (!onmutate) return;
			if (debounce && timer) {
				clearTimeout(timer);
				timer = setTimeout(() => onmutate(entries), debounce);
			} else {
				onmutate(entries);
			}
		});
		observer.observe(el);
		return () => observer.disconnect();
	};
}
