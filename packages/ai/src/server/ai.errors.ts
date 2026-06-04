import { DelightError } from '@delightstack/utilities';
import type { AiErrorCode } from '../types';

/** Status code mapping for AI error codes */
function statusForCode(code: AiErrorCode): number {
	switch (code) {
		case 'RATE_LIMITED':
			return 429;
		case 'MODEL_NOT_FOUND':
			return 404;
		case 'CONTEXT_TOO_LONG':
		case 'CONTENT_FILTERED':
			return 400;
		case 'PROVIDER_ERROR':
		case 'GATEWAY_ERROR':
			return 502;
		case 'STREAM_INTERRUPTED':
		case 'EMBEDDING_FAILED':
		case 'INTERNAL_ERROR':
		default:
			return 500;
	}
}

/** Construct a DelightError for a given AI error code */
export function createAiError(
	code: AiErrorCode,
	details?: Record<string, unknown>,
): DelightError {
	// Use details.message as the human-readable message if available
	const message = typeof details?.message === 'string' ? details.message : code;
	const detail = details ? JSON.stringify(details) : undefined;
	const status =
		typeof details?.status === 'number' ? details.status : statusForCode(code);

	return new DelightError({
		message,
		status,
		code,
		detail,
	});
}
