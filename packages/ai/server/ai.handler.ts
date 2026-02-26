import { DelightError } from '@delightstack/utilities';
import type { RequestEventLike, CompletionOptions, EmbeddingOptions } from '../types';
import type { AiServer } from './ai.server';

// ── Types ───────────────────────────────────────────────────────────────────

/** Minimal SvelteKit Handle type (avoids hard dependency on @sveltejs/kit) */
type Handle = (input: {
	event: RequestEventLike;
	resolve: (event: RequestEventLike) => Promise<Response> | Response;
}) => Promise<Response> | Response;

/** Options for createAiHandle() */
export interface AiHandleOptions {
	/** Path prefix for AI API routes. Default: '/api/ai' */
	path?: string;

	/**
	 * Returns the AI server instance for the current request.
	 * Return undefined if AI is not available (e.g. no auth).
	 */
	getAi: (event: RequestEventLike) => AiServer | undefined;

	/**
	 * Authorization hook. Return true to allow, false to reject with 403.
	 * Default: checks event.locals.session is truthy.
	 */
	authorize?: (event: RequestEventLike) => boolean | Promise<boolean>;

	/**
	 * Model validation hook. Called before any completion or stream request.
	 * Throw or return false to reject the model. Use this to restrict
	 * which models clients can access (e.g. block expensive models).
	 * Default: allows all models.
	 */
	validateModel?: (model: string, event: RequestEventLike) => boolean | Promise<boolean>;
}

// ── Validation helpers ──────────────────────────────────────────────────────

/** Maximum allowed max_tokens to prevent accidental budget burns */
const MAX_TOKENS_LIMIT = 128_000;

/** Safely parse JSON from a request, returning a clean error on invalid JSON */
async function parseJsonBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw DelightError.badRequest('Invalid JSON in request body');
	}
}

function validateCompletionOptions(body: unknown): CompletionOptions {
	if (!body || typeof body !== 'object') {
		throw DelightError.badRequest('Request body must be a JSON object');
	}

	const obj = body as Record<string, unknown>;

	if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
		throw DelightError.badRequest('messages must be a non-empty array');
	}

	if (typeof obj.model !== 'string' || !obj.model.trim()) {
		throw DelightError.badRequest('model must be a non-empty string');
	}

	if (obj.max_tokens != null) {
		if (
			typeof obj.max_tokens !== 'number' ||
			obj.max_tokens < 1 ||
			obj.max_tokens > MAX_TOKENS_LIMIT
		) {
			throw DelightError.badRequest(
				`max_tokens must be between 1 and ${MAX_TOKENS_LIMIT}`,
			);
		}
	}

	if (obj.temperature != null) {
		if (
			typeof obj.temperature !== 'number' ||
			obj.temperature < 0 ||
			obj.temperature > 2
		) {
			throw DelightError.badRequest('temperature must be between 0 and 2');
		}
	}

	if (obj.top_p != null) {
		if (typeof obj.top_p !== 'number' || obj.top_p < 0 || obj.top_p > 1) {
			throw DelightError.badRequest('top_p must be between 0 and 1');
		}
	}

	// Validate each message has role + content
	for (const msg of obj.messages) {
		if (!msg || typeof msg !== 'object') {
			throw DelightError.badRequest('Each message must be an object');
		}
		const m = msg as Record<string, unknown>;
		if (
			typeof m.role !== 'string' ||
			!['system', 'user', 'assistant', 'tool'].includes(m.role)
		) {
			throw DelightError.badRequest('Each message must have a valid role');
		}
		// Assistant messages may have null content (e.g. tool-call-only messages)
		if (m.role === 'assistant') {
			if (m.content != null && typeof m.content !== 'string') {
				throw DelightError.badRequest('Assistant message content must be a string or null');
			}
		} else if (typeof m.content !== 'string') {
			throw DelightError.badRequest('Each message must have string content');
		}
	}

	return obj as unknown as CompletionOptions;
}

function validateEmbeddingOptions(body: unknown): EmbeddingOptions {
	if (!body || typeof body !== 'object') {
		throw DelightError.badRequest('Request body must be a JSON object');
	}

	const obj = body as Record<string, unknown>;

	if (typeof obj.input !== 'string' && !Array.isArray(obj.input)) {
		throw DelightError.badRequest('input must be a string or array of strings');
	}

	if (typeof obj.input === 'string') {
		if (!obj.input.trim()) {
			throw DelightError.badRequest('input must be a non-empty string');
		}
	}

	if (Array.isArray(obj.input)) {
		if (obj.input.length === 0) {
			throw DelightError.badRequest('input array must not be empty');
		}
		for (const item of obj.input) {
			if (typeof item !== 'string') {
				throw DelightError.badRequest('Each input must be a string');
			}
			if (!item.trim()) {
				throw DelightError.badRequest('Each input must be a non-empty string');
			}
		}
	}

	return obj as unknown as EmbeddingOptions;
}

function validateStreamId(body: unknown): { stream_id: string } {
	if (!body || typeof body !== 'object') {
		throw DelightError.badRequest('Request body must be a JSON object');
	}

	const obj = body as Record<string, unknown>;

	if (typeof obj.stream_id !== 'string' || !obj.stream_id.trim()) {
		throw DelightError.badRequest('stream_id must be a non-empty string');
	}

	return { stream_id: obj.stream_id };
}

// ── Handle ──────────────────────────────────────────────────────────────────

/**
 * Creates a SvelteKit Handle that exposes AI endpoints:
 *
 * - POST /api/ai/complete   — Non-streaming chat completion
 * - POST /api/ai/embed      — Generate embeddings
 * - POST /api/ai/stream     — Start a streaming completion (returns stream_id, streams via WebSocket)
 * - POST /api/ai/cancel     — Cancel an active stream
 *
 * Resume is handled via WebSocket messages (ai:stream:resume), not HTTP.
 * Use createAiMessageHandler() to wire up resume/cancel in your WebSocket server.
 *
 * Usage:
 *   const aiHandle = createAiHandle({
 *     getAi: (event) => event.locals.ai,
 *     validateModel: (model) => !model.startsWith('dynamic/admin'),
 *   });
 *   export const handle = sequence(authHandle, aiHandle, databaseHandle);
 */
export function createAiHandle(options: AiHandleOptions): Handle {
	const prefix = options.path ?? '/api/ai';

	return async ({ event, resolve }) => {
		const { pathname } = event.url;

		// Only intercept routes under the AI prefix
		if (!pathname.startsWith(prefix + '/') && pathname !== prefix) {
			return resolve(event);
		}

		// Only accept POST
		if (event.request.method !== 'POST') {
			return new Response(
				JSON.stringify({ status: 405, message: 'Method not allowed' }),
				{ status: 405, headers: { 'Content-Type': 'application/json' } },
			);
		}

		// Authorize
		const authorized = options.authorize
			? await options.authorize(event)
			: !!event.locals.session;

		if (!authorized) {
			return DelightError.unauthorized('Unauthorized').toResponse();
		}

		// Get AI instance
		const ai = options.getAi(event);
		if (!ai) {
			return DelightError.badRequest('AI not available').toResponse();
		}

		// Route to handler
		const route = pathname.slice(prefix.length);

		try {
			switch (route) {
				case '/complete':
					return await handleComplete(event, ai, options);
				case '/embed':
					return await handleEmbed(event, ai);
				case '/stream':
					return await handleStream(event, ai, options);
				case '/cancel':
					return await handleCancel(event, ai);
				default:
					return new Response(JSON.stringify({ status: 404, message: 'Not found' }), {
						status: 404,
						headers: { 'Content-Type': 'application/json' },
					});
			}
		} catch (error: unknown) {
			const err = DelightError.from(error);
			return err.toResponse();
		}
	};
}

// ── Route handlers ──────────────────────────────────────────────────────────

async function handleComplete(
	event: RequestEventLike,
	ai: AiServer,
	handleOpts: AiHandleOptions,
): Promise<Response> {
	const body = await parseJsonBody(event.request);
	const options = validateCompletionOptions(body);

	if (handleOpts.validateModel) {
		const allowed = await handleOpts.validateModel(options.model, event);
		if (!allowed) {
			throw DelightError.forbidden(`Model '${options.model}' is not allowed`);
		}
	}

	const result = await ai.complete(options);
	return Response.json(result);
}

async function handleEmbed(event: RequestEventLike, ai: AiServer): Promise<Response> {
	const body = await parseJsonBody(event.request);
	const options = validateEmbeddingOptions(body);
	const result = await ai.embed(options);
	return Response.json(result);
}

async function handleStream(
	event: RequestEventLike,
	ai: AiServer,
	handleOpts: AiHandleOptions,
): Promise<Response> {
	const body = await parseJsonBody(event.request);
	const options = validateCompletionOptions(body);

	if (handleOpts.validateModel) {
		const allowed = await handleOpts.validateModel(options.model, event);
		if (!allowed) {
			throw DelightError.forbidden(`Model '${options.model}' is not allowed`);
		}
	}

	const result = await ai.streamToClient(options);
	return Response.json(result);
}

async function handleCancel(event: RequestEventLike, ai: AiServer): Promise<Response> {
	const body = await parseJsonBody(event.request);
	const { stream_id } = validateStreamId(body);
	ai.cancelStream(stream_id);
	return Response.json({ ok: true });
}
