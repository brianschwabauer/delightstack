import type { Attachment } from 'svelte/attachments';

export interface FocustWithinOptions {
	/** Whether the event listeners should be enabled. @default true */
	enabled?: boolean;

	/** Called when the focus changes within the element. Emits true when focused and false if not  */
	onfocuswithin?: (focused: boolean) => void;
}

/**
 * Svelte attachment that adds a 'focus-within' class to the element when it or any of its children are focused.
 * It also calls the `onfocuswithin` callback with the current focus state.
 * @example
 * ```svelte
 * <div {@attach onFocusWithin({ onfocuswithin: (focused) => console.log('focused', focused) })}</div>
 * ```
 */
export function onFocusWithin(options?: FocustWithinOptions): Attachment<HTMLElement> {
	let isFocused = false;
	const isChildInParent = (child: HTMLElement, parent: HTMLElement): boolean => {
		if (child === parent) return true;
		if (child.parentElement) return isChildInParent(child.parentElement, parent);
		return false;
	};
	const checkFocus = (el: HTMLElement) => {
		const focusedElement = document.activeElement;
		if (isChildInParent(focusedElement as HTMLElement, el)) {
			if (!isFocused) {
				isFocused = true;
				el.classList.add('focus-within');
				el.dispatchEvent(new CustomEvent('focuswithin', { detail: isFocused }));
				options?.onfocuswithin?.(isFocused);
			}
		} else {
			if (isFocused) {
				isFocused = false;
				el.classList.remove('focus-within');
				el.dispatchEvent(new CustomEvent('focuswithin', { detail: isFocused }));
				options?.onfocuswithin?.(isFocused);
			}
		}
	};

	return (el: HTMLElement) => {
		let timer: number | undefined = undefined;
		const onFocusChange = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(checkFocus, 30);
		};
		checkFocus(el);
		if (options?.enabled !== false) {
			el.addEventListener('focusin', onFocusChange);
			el.addEventListener('focusout', onFocusChange);
		}
		return () => {
			el.removeEventListener('focusin', onFocusChange);
			el.removeEventListener('focusout', onFocusChange);
		};
	};
}
