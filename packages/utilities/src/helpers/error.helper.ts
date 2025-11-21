import { ZodError, ZodType } from 'zod/v4';

/** Data included in an api error */
export interface ApiErrorData {
	/** The user friendly message to display */
	message: string;
	/** The HTTP status to return @default 500 */
	status: number;
	/** Additional technical information that won't be shown to the user */
	detail?: string;
	/** A list of additional errors that occurred (but arent' the primary error) */
	errors?: ApiErrorData[];
}

/** An error thrown by the api/database */
export class ApiError extends Error {
	public messageText: string;

	constructor(
		message = 'Unknown api error',
		public status = 500,
		public detail: string | undefined = undefined,
		public errors: ApiErrorData[] = [],
	) {
		super(
			JSON.stringify({
				message,
				status,
				detail,
				errors: errors.length ? errors : undefined,
			}),
		);
		this.messageText = message;
		this.name = 'ApiError';
	}
	/** Returns whether the given error object is an instance of this class */
	static isInstance(error: any) {
		return error instanceof ApiError && error.name === this.name;
	}

	/** Returns an ApiError instance from the given error object */
	static from(error: any): ApiError {
		console.log(error?.message, error?.stack, error);
		if (ApiError.isInstance(error)) return error;
		let message: string | undefined;
		let status: number | undefined;
		let detail: string | undefined;
		let errors: NonNullable<ApiErrorData['errors']> = [];
		try {
			if (error instanceof ZodError) {
				error.issues.forEach((issue) => {
					errors.push({
						status: 400,
						detail: issue.code,
						message: `Invalid value for '${issue.path.join('.')}'. ${
							issue.message || message
						}.`,
					});
				});
				message = errors[0]?.message || message;
				status = 400;
			} else if (error instanceof Error) {
				try {
					const parsed = JSON.parse(error.message.replace(/^[^{]+/, ''));
					if (parsed?.status) status = parsed.status;
					if (parsed?.message) message = parsed.message;
					if (parsed?.detail) detail = parsed.detail;
					if (parsed?.errors?.length) errors = parsed.errors;
				} catch (_) {
					message = error?.message || message;
				}
			} else if (typeof error === 'object' && error) {
				if ((error as any)?.status) status = (error as any).status;
				if ((error as any)?.message) message = (error as any).message;
				if ((error as any)?.detail) detail = (error as any).detail;
				if ((error as any)?.errors?.length) errors = (error as any).errors;
			} else if (typeof error === 'string') {
				try {
					const parsed = JSON.parse(error.replace(/^[^{]+/, ''));
					if (parsed?.status) status = parsed.status;
					if (parsed?.message) message = parsed.message;
					if (parsed?.detail) detail = parsed.detail;
					if (parsed?.errors?.length) errors = parsed.errors;
				} catch (_) {
					message = error;
				}
			}
		} catch (error) {
			// ignore
		}
		return new ApiError(message, status, detail, errors);
	}

	/** The message is alread JSON encoded so just return it */
	toJSON() {
		return this.message;
	}

	/** Returns the main error message text */
	toString() {
		return this.messageText;
	}
}

/**
 * Returns an error with the given data
 * Throw an error like `throw apiError({ message: 'Error message', status: 400 })`
 */
export function apiError(errorData?: Partial<ApiErrorData>) {
	return new ApiError(
		errorData?.message,
		errorData?.status,
		errorData?.detail,
		errorData?.errors,
	);
}

/** Parses the data for the given schema and rethrows any error that occurs, but with better error formatting */
export function parseSchema<T extends ZodType>(schema: T, value: any): T['_output'] {
	try {
		return schema.parse(value);
	} catch (error: any) {
		throw ApiError.from(error);
	}
}
