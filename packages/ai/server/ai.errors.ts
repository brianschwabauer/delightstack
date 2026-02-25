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
	const detail = details ? JSON.stringify(details) : undefined;
	return new DelightError({
		message: `${code}${detail ? `: ${detail}` : ''}`,
		status: statusForCode(code),
		code,
		detail,
	});
}
