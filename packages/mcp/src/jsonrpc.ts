import { DelightError } from '@delightstack/utilities';
import type {
	JsonRpcFailure,
	JsonRpcId,
	JsonRpcRequest,
	JsonRpcSuccess,
} from './types.js';

/**
 * JSON-RPC 2.0 framing for the MCP endpoint.
 *
 * The error codes below are the standard set plus the two MCP allocates from
 * the reserved sub-range. Everything above -32000 is application space.
 */
export const JSON_RPC_ERROR = {
	parse: -32700,
	invalid_request: -32600,
	method_not_found: -32601,
	invalid_params: -32602,
	internal: -32603,
	/** MCP: the mirrored headers disagree with the body. */
	header_mismatch: -32020,
	/** Application: the caller's token does not carry the tool's scope. */
	forbidden: -32001,
	/** Application: the caller is over its rate limit. */
	rate_limited: -32002,
} as const;

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
	return { jsonrpc: '2.0', id, result };
}

export function failure(
	id: JsonRpcId,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcFailure {
	return {
		jsonrpc: '2.0',
		id,
		error: data === undefined ? { code, message } : { code, message, data },
	};
}

/**
 * Maps a thrown value onto a JSON-RPC error.
 *
 * A `DelightError` carries an HTTP status, which is the only signal available
 * for choosing a code: 4xx is the caller's fault (`invalid_params`, or
 * `forbidden` for 401/403), everything else is ours (`internal`). The message
 * is passed through — `DelightError`'s message is written for a person to read,
 * which is exactly what an agent needs — while a non-`DelightError` throw is
 * reported without its message, because an unplanned stack can carry anything.
 */
export function errorToJsonRpc(id: JsonRpcId, error: unknown): JsonRpcFailure {
	if (DelightError.is(error)) {
		const status = error.status;
		const code =
			status === 401 || status === 403
				? JSON_RPC_ERROR.forbidden
				: status === 429
					? JSON_RPC_ERROR.rate_limited
					: status >= 400 && status < 500
						? JSON_RPC_ERROR.invalid_params
						: JSON_RPC_ERROR.internal;
		return failure(id, code, error.message, {
			status,
			...(error.code ? { code: error.code } : {}),
			...(error.errors.length ? { errors: error.errors } : {}),
		});
	}
	return failure(id, JSON_RPC_ERROR.internal, 'Internal error');
}

/** Whether a parsed message is a well-formed request or notification. */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const message = value as Record<string, unknown>;
	if (message.jsonrpc !== '2.0') return false;
	if (typeof message.method !== 'string') return false;
	if ('id' in message) {
		const id = message.id;
		const ok = typeof id === 'string' || typeof id === 'number' || id === null;
		if (!ok) return false;
	}
	if ('params' in message && message.params !== undefined) {
		const params = message.params;
		if (typeof params !== 'object' || params === null || Array.isArray(params))
			return false;
	}
	return true;
}

/** A notification is a request with no `id` at all. `id: null` is a request. */
export function isNotification(message: JsonRpcRequest): boolean {
	return !('id' in message) || message.id === undefined;
}
