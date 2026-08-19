/**
 * The package's error type.
 *
 * `@delightstack/diff` has **zero dependencies** — not even on `@delightstack/utilities` —
 * so it cannot throw a `DelightError`. `DiffError` is deliberately shaped the same way
 * (`message`, `status`, `code`), so an app that already narrows on `status` / `code` treats
 * it identically without a special case.
 */
export class DiffError extends Error {
	/** HTTP-ish status. Always `400`: every case is bad input, never an internal failure. */
	readonly status: number;
	/** Stable machine-readable code. See the README for the list. */
	readonly code: string;

	constructor(message: string, code: string, status = 400) {
		super(message);
		this.name = 'DiffError';
		this.status = status;
		this.code = code;
	}
}
