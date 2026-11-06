/**
 * Save-on-commit feedback for form controls. When a control's `onchange`
 * returns a promise, the control shows that it is saving, then a checkmark
 * when it resolves, or the rejection's message as its error when it fails.
 *
 * Timing follows Button's async pattern: no spinner for a save that settles
 * within SHOW_DELAY (no flash), a spinner that once shown stays MIN_VISIBLE,
 * then a checkmark held for CHECK_HOLD. Unlike Button, a fast save still gets
 * its checkmark: an autosaving field has no other way to say "saved".
 *
 * A newer change supersedes an older one still in flight; only the latest
 * settles the state.
 */

const SHOW_DELAY = 100;
const MIN_VISIBLE = 600;
const CHECK_HOLD = 1400;

export class AsyncChange {
	/** A returned promise is still running. */
	busy = $state(false);
	/** The spinner is showing (busy, past SHOW_DELAY). */
	spinner = $state(false);
	/** The success checkmark is showing. */
	check = $state(false);
	/** The last save's failure message, until the value changes again. */
	error = $state<string | undefined>(undefined);

	#token = 0;
	#shown_at = 0;
	#show_timer: ReturnType<typeof setTimeout> | undefined;
	#hide_timer: ReturnType<typeof setTimeout> | undefined;
	#check_timer: ReturnType<typeof setTimeout> | undefined;

	/** Pass whatever `onchange` returned; anything but a thenable is ignored. */
	track(result: unknown) {
		if (!isThenable(result)) return;
		const token = ++this.#token;
		this.#clearTimers();
		this.check = false;
		this.error = undefined;
		this.busy = true;
		this.spinner = false;
		this.#show_timer = setTimeout(() => {
			this.#show_timer = undefined;
			this.spinner = true;
			this.#shown_at = performance.now();
		}, SHOW_DELAY);
		result.then(
			() => this.#settle(token, undefined),
			(reason: unknown) => this.#settle(token, messageOf(reason)),
		);
	}

	/** The user is changing the value again: an old failure no longer applies. */
	clearError() {
		this.error = undefined;
	}

	destroy() {
		this.#clearTimers();
	}

	#settle(token: number, error: string | undefined) {
		if (token !== this.#token) return;
		const finish = () => {
			this.busy = false;
			this.spinner = false;
			if (error) {
				this.error = error;
				return;
			}
			this.check = true;
			this.#check_timer = setTimeout(() => (this.check = false), CHECK_HOLD);
		};
		if (this.#show_timer) {
			clearTimeout(this.#show_timer);
			this.#show_timer = undefined;
			finish();
			return;
		}
		const remaining = Math.max(0, MIN_VISIBLE - (performance.now() - this.#shown_at));
		this.#hide_timer = setTimeout(finish, remaining);
	}

	#clearTimers() {
		clearTimeout(this.#show_timer);
		clearTimeout(this.#hide_timer);
		clearTimeout(this.#check_timer);
		this.#show_timer = this.#hide_timer = this.#check_timer = undefined;
	}
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		!!value &&
		(typeof value === 'object' || typeof value === 'function') &&
		typeof (value as PromiseLike<unknown>).then === 'function'
	);
}

function messageOf(reason: unknown): string {
	if (typeof reason === 'string' && reason) return reason;
	const message = (reason as { message?: unknown } | null)?.message;
	return typeof message === 'string' && message ? message : 'Could not save. Try again.';
}
