import type { ErrorCode } from './types';

/** Base error class for all image processor errors */
export class ImageProcessorError extends Error {
	constructor(
		public code: ErrorCode,
		public status: number,
		public details?: Record<string, unknown>,
	) {
		super(`${code}${details ? `: ${JSON.stringify(details)}` : ''}`);
		this.name = 'ImageProcessorError';
	}
}

/** Validation errors (4xx) — the input is bad */
export class ValidationError extends ImageProcessorError {
	constructor(code: ErrorCode, details?: Record<string, unknown>, status = 400) {
		super(code, status, details);
		this.name = 'ValidationError';
	}
}

/** Processing errors (5xx) — something went wrong during processing */
export class ProcessingError extends ImageProcessorError {
	constructor(code: ErrorCode, details?: Record<string, unknown>, status = 500) {
		super(code, status, details);
		this.name = 'ProcessingError';
	}
}

/** Timeout errors (504) — processing took too long */
export class TimeoutError extends ImageProcessorError {
	constructor(code: ErrorCode, details?: Record<string, unknown>, status = 504) {
		super(code, status, details);
		this.name = 'TimeoutError';
	}
}

/** Construct the right error subclass for a given error code */
export function createError(code: ErrorCode, details?: Record<string, unknown>): ImageProcessorError {
	switch (code) {
		case 'FILE_TOO_LARGE':
		case 'DIMENSIONS_TOO_LARGE':
		case 'UNSUPPORTED_FORMAT':
		case 'TOO_MANY_FRAMES':
		case 'CORRUPTED_FILE':
		case 'SVG_MALICIOUS':
			return new ValidationError(code, details);
		case 'FILE_NOT_FOUND':
			return new ValidationError(code, details, 404);
		case 'PROCESSING_TIMEOUT':
			return new TimeoutError(code, details);
		case 'CONTAINER_UNAVAILABLE':
			return new ProcessingError(code, details, 503);
		case 'INTERNAL_ERROR':
		default:
			return new ProcessingError(code, details);
	}
}
