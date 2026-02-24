import { DelightError } from '@delightstack/utilities';
import type { ErrorCode } from './types';

/** Status code mapping for image error codes */
function statusForCode(code: ErrorCode): number {
	switch (code) {
		case 'FILE_TOO_LARGE':
		case 'DIMENSIONS_TOO_LARGE':
		case 'UNSUPPORTED_FORMAT':
		case 'TOO_MANY_FRAMES':
		case 'CORRUPTED_FILE':
		case 'SVG_MALICIOUS':
			return 400;
		case 'FILE_NOT_FOUND':
			return 404;
		case 'PROCESSING_TIMEOUT':
			return 504;
		case 'CONTAINER_UNAVAILABLE':
			return 503;
		case 'INTERNAL_ERROR':
		default:
			return 500;
	}
}

/** Construct a DelightError for a given image error code */
export function createError(
	code: ErrorCode,
	details?: Record<string, unknown>,
): DelightError {
	const detail = details ? JSON.stringify(details) : undefined;
	return new DelightError({
		message: `${code}${detail ? `: ${detail}` : ''}`,
		status: statusForCode(code),
		code,
		detail,
	});
}
