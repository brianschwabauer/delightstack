import { createFocusTrap } from 'focus-trap';
import type { Options, FocusTrap } from 'focus-trap';
import type { Attachment } from 'svelte/attachments';

export interface FocusTrapOptions extends Options {
	/** Whether the focus trap should be enabled. @default true */
	enabled?: boolean;

	/** Called when the focus trap is initialized */
	oninit?: (event: FocusTrap) => void;
}

/**
 * Simple svelte attachment wrapper around the focus-trap package.
 * This is useful for when you want to use focus-trap in a Svelte component because this handles the lifecycle of the focus trap.
 *
 * The container itself is used as the trap's `fallbackFocus` unless the caller
 * names one, because an attachment runs while the elements it wraps are still
 * arriving: `{@attach focusTrap()}` fires in the same flush that creates the
 * modal's children, and a child that is not tabbable *yet* (a delightstack
 * `Button` renders `disabled tabindex="-1"` until its own mount effect lands)
 * leaves the container momentarily empty of tabbable nodes. focus-trap refuses
 * to activate in that state, and since it throws before setting `active` the
 * trap would otherwise stay off for good — no Escape, no Tab containment, no
 * initial focus. Holding focus on the container bridges that window; the real
 * tabbable children are picked up by the next `updateTabbableNodes()` (any
 * focusin, or the first Tab).
 *
 * @example
 * ```svelte
 * <div {@attach focusTrap({ enabled: true })}</div>
 * ```
 */
export function focusTrap(options?: FocusTrapOptions): Attachment<HTMLElement> {
	let trap: FocusTrap | undefined;
	/** Whether the `tabindex` on the container is ours to take back off. */
	let added_tabindex = false;
	const own_fallback = options?.fallbackFocus === undefined;
	return (el: HTMLElement) => {
		// `fallbackFocus` has to be programmatically focusable to be of any use,
		// so give the container the `tabindex` it is missing. Re-checked every
		// run, because a teardown between runs takes it back off again.
		if (own_fallback && !el.hasAttribute('tabindex')) {
			el.setAttribute('tabindex', '-1');
			added_tabindex = true;
		}
		if (!trap) {
			trap = createFocusTrap(el, {
				...options,
				fallbackFocus: options?.fallbackFocus ?? el,
			});
			options?.oninit?.(trap);
		}
		const shouldEnable = options?.enabled ?? true;
		if (shouldEnable && !trap.active) {
			try {
				trap.activate();
			} catch (error) {
				// Never swallow this: activation is all-or-nothing, so a trap
				// that failed here is a modal the keyboard can walk straight
				// out of, with nothing else to show for it.
				console.error('[delightstack] focusTrap could not activate', error, el);
			}
		}
		if (!shouldEnable && trap.active) trap.deactivate();
		return () => {
			trap?.deactivate();
			if (added_tabindex) {
				el.removeAttribute('tabindex');
				added_tabindex = false;
			}
		};
	};
}
