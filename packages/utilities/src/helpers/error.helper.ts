import { ZodError, ZodType } from 'zod/v4';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data shape for serialized error output */
export interface DelightErrorData {
	/** The user friendly message to display */
	message: string;
	/** The HTTP status to return @default 500 */
	status: number;
	/** Machine-readable error code */
	code?: string;
	/** Additional technical information that won't be shown to the user */
	detail?: string;
	/** A list of additional errors (e.g. per-field validation errors) */
	errors?: DelightErrorData[];
}

/** Options for constructing a DelightError */
export interface DelightErrorOptions {
	message: string;
	status?: number;
	code?: string;
	detail?: string;
	errors?: DelightErrorData[];
	cause?: unknown;
}

// ---------------------------------------------------------------------------
// DelightError
// ---------------------------------------------------------------------------

/** Unified error class for the entire Delightstack codebase */
export class DelightError extends Error {
	readonly status: number;
	readonly code: string | undefined;
	readonly detail: string | undefined;
	readonly errors: DelightErrorData[];

	constructor(message: string);
	constructor(options: DelightErrorOptions);
	constructor(arg: string | DelightErrorOptions) {
		const opts = typeof arg === 'string' ? { message: arg } : arg;
		super(opts.message, opts.cause ? { cause: opts.cause } : undefined);
		this.name = 'DelightError';
		this.status = opts.status ?? 500;
		this.code = opts.code;
		this.detail = opts.detail;
		this.errors = opts.errors ?? [];
	}

	// --- Static factory methods ---

	static badRequest(
		message: string,
		options?: Omit<DelightErrorOptions, 'message' | 'status'>,
	): DelightError {
		return new DelightError({ ...options, message, status: 400 });
	}

	static unauthorized(
		message: string,
		options?: Omit<DelightErrorOptions, 'message' | 'status'>,
	): DelightError {
		return new DelightError({ ...options, message, status: 401 });
	}

	static forbidden(
		message: string,
		options?: Omit<DelightErrorOptions, 'message' | 'status'>,
	): DelightError {
		return new DelightError({ ...options, message, status: 403 });
	}

	static notFound(
		message: string,
		options?: Omit<DelightErrorOptions, 'message' | 'status'>,
	): DelightError {
		return new DelightError({ ...options, message, status: 404 });
	}

	static rateLimit(
		message: string,
		options?: Omit<DelightErrorOptions, 'message' | 'status'>,
	): DelightError {
		return new DelightError({ ...options, message, status: 429 });
	}

	// --- Conversion ---

	/** Type guard: check if a value is a DelightError */
	static is(error: unknown): error is DelightError {
		return error instanceof DelightError;
	}

	/** Normalize any error into a DelightError */
	static from(error: unknown): DelightError {
		if (error instanceof DelightError) return error;

		let message: string | undefined;
		let status: number | undefined;
		let code: string | undefined;
		let detail: string | undefined;
		let errors: DelightErrorData[] = [];
		const cause: unknown = error;

		try {
			if (error instanceof ZodError) {
				error.issues.forEach((issue) => {
					errors.push({
						status: 400,
						detail: issue.code,
						message: `Invalid value for '${issue.path.join('.')}'. ${issue.message}.`,
					});
				});
				message = errors[0]?.message;
				status = 400;
			} else if (error instanceof Error) {
				try {
					const parsed = JSON.parse(error.message.replace(/^[^{]+/, ''));
					if (parsed?.status) status = parsed.status;
					if (parsed?.message) message = parsed.message;
					if (parsed?.code) code = parsed.code;
					if (parsed?.detail) detail = parsed.detail;
					if (parsed?.errors?.length) errors = parsed.errors;
				} catch {
					message = error.message;
				}
			} else if (typeof error === 'object' && error !== null) {
				const obj = error as Record<string, unknown>;
				if (typeof obj.status === 'number') status = obj.status;
				if (typeof obj.message === 'string') message = obj.message;
				if (typeof obj.code === 'string') code = obj.code;
				if (typeof obj.detail === 'string') detail = obj.detail;
				if (Array.isArray(obj.errors)) errors = obj.errors;
			} else if (typeof error === 'string') {
				try {
					const parsed = JSON.parse(error.replace(/^[^{]+/, ''));
					if (parsed?.status) status = parsed.status;
					if (parsed?.message) message = parsed.message;
					if (parsed?.code) code = parsed.code;
					if (parsed?.detail) detail = parsed.detail;
					if (parsed?.errors?.length) errors = parsed.errors;
				} catch {
					message = error;
				}
			}
		} catch {
			// ignore
		}

		return new DelightError({
			message: message ?? 'Unknown error',
			status,
			code,
			detail,
			errors,
			cause,
		});
	}

	// --- Worker serialization ---

	/**
	 * Creates an error that encodes its data in the message string so it
	 * survives structured-clone transfer (e.g. through comlink workers).
	 */
	static transferable(options: DelightErrorOptions): DelightError {
		const err = new DelightError(options);
		// Overwrite the inherited `message` with a JSON envelope so comlink preserves it
		Object.defineProperty(err, 'message', {
			value: JSON.stringify({
				__delight_error__: true,
				message: options.message,
				status: err.status,
				code: err.code,
				detail: err.detail,
				errors: err.errors.length ? err.errors : undefined,
			}),
			writable: false,
			enumerable: true,
			configurable: true,
		});
		return err;
	}

	/**
	 * Parse an error that was transferred through comlink from a worker.
	 * Returns a DelightError with clean fields, or null if not a transferable error.
	 */
	static fromWorker(error: unknown): DelightError | null {
		if (!(error instanceof Error)) return null;
		try {
			const parsed = JSON.parse(error.message);
			if (!parsed?.__delight_error__) return null;
			if (typeof parsed.status !== 'number' || typeof parsed.message !== 'string')
				return null;
			return new DelightError({
				message: parsed.message,
				status: parsed.status,
				code: parsed.code,
				detail: parsed.detail,
				errors: parsed.errors,
				cause: error,
			});
		} catch {
			return null;
		}
	}

	// --- Serialization ---

	/** Returns a clean object representation (NOT a JSON string) */
	toJSON(): DelightErrorData {
		return {
			message: this.message,
			status: this.status,
			...(this.code ? { code: this.code } : {}),
			...(this.detail ? { detail: this.detail } : {}),
			...(this.errors.length ? { errors: this.errors } : {}),
		};
	}

	/** Returns a Response suitable for Cloudflare Worker routes */
	toResponse(): Response {
		return new Response(JSON.stringify(this.toJSON()), {
			status: this.status,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	/** Returns the plain-text message */
	toString(): string {
		return this.message;
	}
}
// ---------------------------------------------------------------------------
// Schema parsing helper
// ---------------------------------------------------------------------------

/** Parses data against a Zod schema and rethrows with better formatting */
export function parseSchema<T extends ZodType>(schema: T, value: unknown): T['_output'] {
	try {
		return schema.parse(value);
	} catch (error: unknown) {
		throw DelightError.from(error);
	}
}
