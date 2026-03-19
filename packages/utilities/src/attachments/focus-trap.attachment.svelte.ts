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
 * @example
 * ```svelte
 * <div {@attach focusTrap({ enabled: true })}</div>
 * ```
 */
export function focusTrap(options?: FocusTrapOptions): Attachment {
	let trap: FocusTrap | undefined;
	return (el: HTMLElement) => {
		if (!trap) {
			trap = createFocusTrap(el, options);
			if (options.oninit) options.oninit(trap);
		}
		const shouldEnable = options?.enabled ?? true;
		if (shouldEnable && !trap.active) {
			try {
				trap.activate();
			} catch {
				// Focus trap activation can fail when the container has no tabbable nodes
			}
		}
		if (!shouldEnable && trap.active) trap.deactivate();
		return () => trap?.deactivate();
	};
}
