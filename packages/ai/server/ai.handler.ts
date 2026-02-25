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
}

// ── Handle ──────────────────────────────────────────────────────────────────

/**
 * Creates a SvelteKit Handle that exposes AI endpoints:
 *
 * - POST /api/ai/complete   — Non-streaming chat completion
 * - POST /api/ai/embed      — Generate embeddings
 * - POST /api/ai/stream     — Start a streaming completion (returns stream_id, streams via WebSocket)
 * - POST /api/ai/resume     — Resume a disconnected stream
 * - POST /api/ai/cancel     — Cancel an active stream
 *
 * Usage:
 *   const aiHandle = createAiHandle({
 *     getAi: (event) => event.locals.ai,
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
					return await handleComplete(event, ai);
				case '/embed':
					return await handleEmbed(event, ai);
				case '/stream':
					return await handleStream(event, ai);
				case '/resume':
					return await handleResume(event, ai);
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

async function handleComplete(event: RequestEventLike, ai: AiServer): Promise<Response> {
	const body = (await event.request.json()) as CompletionOptions;
	const result = await ai.complete(body);
	return Response.json(result);
}

async function handleEmbed(event: RequestEventLike, ai: AiServer): Promise<Response> {
	const body = (await event.request.json()) as EmbeddingOptions;
	const result = await ai.embed(body);
	return Response.json(result);
}

async function handleStream(event: RequestEventLike, ai: AiServer): Promise<Response> {
	const body = (await event.request.json()) as CompletionOptions;
	const result = await ai.streamToClient(body);
	return Response.json(result);
}

async function handleResume(event: RequestEventLike, ai: AiServer): Promise<Response> {
	const body = (await event.request.json()) as { stream_id: string; last_offset: number };
	return Response.json({ ok: true, stream_id: body.stream_id });
}

async function handleCancel(event: RequestEventLike, ai: AiServer): Promise<Response> {
	const body = (await event.request.json()) as { stream_id: string };
	ai.cancelStream(body.stream_id);
	return Response.json({ ok: true });
}
