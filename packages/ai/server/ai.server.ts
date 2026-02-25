import type { DatabaseServer } from '@delightstack/database';
import type { WebsocketServer } from '@delightstack/websocket/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabaseServer = DatabaseServer<any>;
import type {
	AiProcessingOptions,
	CompletionOptions,
	CompletionResult,
	StreamChunk,
	EmbeddingOptions,
	EmbeddingResult,
	AiErrorCode,
} from '../types';
import type { AiStreamChunkMessage, AiStreamErrorMessage } from '../types/message.type';
import { createAiGateway, type AiGatewayClient } from './ai.gateway';
import { aiEmbeddings } from './ai.embeddings';
import { createAiError } from './ai.errors';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AiServerOptions extends AiProcessingOptions {
	/**
	 * WebSocket server for broadcasting stream chunks.
	 * Required for resumable streaming via streamToClient().
	 */
	ws?: () => WebsocketServer | undefined;
}

/** In-memory buffer for a streaming response, enabling resumability */
interface StreamBuffer {
	stream_id: string;
	accumulated: string;
	done: boolean;
	abort: (() => void) | null;
	created_at: number;
}

export interface AiServer {
	/** Non-streaming chat completion */
	complete(options: CompletionOptions): Promise<CompletionResult>;
	/** Streaming chat completion (returns async iterable of chunks) */
	stream(options: CompletionOptions): AsyncGenerator<StreamChunk, void, unknown> & {
		stream_id: string;
		abort: () => void;
	};
	/** Generate embeddings directly */
	embed(options: EmbeddingOptions): Promise<EmbeddingResult>;
	/** Get gateway URL for provider SDK integration (e.g. for OpenAI or Anthropic SDK) */
	getProviderUrl(provider: string): Promise<string>;
	/** The underlying AI Gateway client */
	gateway: AiGatewayClient;

	/**
	 * Stream a completion over WebSocket to all clients in the room.
	 * Buffers chunks in memory for resumability.
	 * Returns the stream_id for client-side tracking.
	 */
	streamToClient(options: CompletionOptions): Promise<{ stream_id: string }>;
	/**
	 * Resume a previously interrupted stream from a given offset.
	 * Replays buffered chunks then continues live.
	 */
	resumeStream(ws: WebSocket, stream_id: string, last_offset: number): void;
	/** Cancel an active stream */
	cancelStream(stream_id: string): void;

	/** Check if entity needs re-embedding and schedule if so */
	scheduleIfChanged(
		entity_type: string,
		id: string | number,
		data: Record<string, unknown>,
	): Promise<void>;
	/** Process pending embedding jobs (call from DO alarm handler) */
	processAlarm(): Promise<void>;
	/** Force re-embed a specific record */
	reembed(entity_type: string, id: string | number): Promise<void>;
	/** Backfill embeddings for all un-embedded records of an entity type */
	backfill(entity_type: string): Promise<{ processed: number; failed: number }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** TTL for stream buffers (5 minutes) */
const BUFFER_TTL = 5 * 60 * 1000;

/** Maximum number of stream buffers to keep in memory */
const MAX_BUFFERS = 100;

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Factory function for AI capabilities integrated with @delightstack/database.
 *
 * This is the main entry point for the AI package on the server. It composes
 * the AI Gateway client and embedding processing into a single interface.
 *
 * Usage:
 *   const ai = aiProcessing(db, {
 *     ai: () => env.AI,
 *     storage: this.ctx.storage,
 *     gateway: 'my-gateway',
 *     ws: () => this.ws,
 *     fields: [
 *       { entity_type: 'article', source_fields: ['title', 'body'] },
 *     ],
 *   });
 *
 *   // Chat completion
 *   const result = await ai.complete({ messages: [...], model: 'gpt-4o' });
 *
 *   // Streaming (via WebSocket for resumability)
 *   const { stream_id } = await ai.streamToClient({ messages: [...], model: 'gpt-4o' });
 *
 *   // Embedding alarm (call from DO alarm handler)
 *   async alarm() { await ai.processAlarm(); }
 */
export function aiProcessing(db: AnyDatabaseServer, options: AiServerOptions): AiServer {
	// Lazy gateway creation — AI binding may not be available at construction time
	let _gateway: AiGatewayClient | null = null;
	function getGateway(): AiGatewayClient {
		if (!_gateway) {
			_gateway = createAiGateway({
				ai: options.ai(),
				gateway: options.gateway,
			});
		}
		return _gateway;
	}

	// Only create embeddings processor when fields and storage are provided
	const embeddings =
		options.fields?.length && options.storage
			? aiEmbeddings(db, {
					...options,
					fields: options.fields,
					storage: options.storage,
					ws: options.ws,
				})
			: null;

	// In-memory stream buffers for resumability
	const streamBuffers = new Map<string, StreamBuffer>();

	/** Clean up expired and excess stream buffers */
	function cleanBuffers(): void {
		const now = Date.now();
		for (const [id, buffer] of streamBuffers) {
			if (buffer.done && now - buffer.created_at > BUFFER_TTL) {
				streamBuffers.delete(id);
			}
		}
		// Safety cap: evict oldest buffers (done first, then active) when over limit
		if (streamBuffers.size > MAX_BUFFERS) {
			const entries = [...streamBuffers.entries()].sort(([, a], [, b]) => {
				// Sort done buffers before active ones, then by age
				if (a.done !== b.done) return a.done ? -1 : 1;
				return a.created_at - b.created_at;
			});
			for (const [id, buf] of entries.slice(0, streamBuffers.size - MAX_BUFFERS)) {
				if (buf.abort) buf.abort();
				streamBuffers.delete(id);
			}
		}
	}

	// Periodic cleanup interval (every 60s) to catch abandoned streams
	let cleanupInterval: ReturnType<typeof setInterval> | null = null;
	function ensureCleanupInterval(): void {
		if (cleanupInterval) return;
		cleanupInterval = setInterval(() => {
			cleanBuffers();
			// Stop interval when no buffers remain
			if (streamBuffers.size === 0 && cleanupInterval) {
				clearInterval(cleanupInterval);
				cleanupInterval = null;
			}
		}, 60_000);
	}

	return {
		// ── Gateway pass-through ────────────────────────────────────────────

		complete: (opts) => getGateway().complete(opts),
		stream: (opts) => getGateway().stream(opts),
		embed: (opts) => getGateway().embed(opts),
		getProviderUrl: (provider) => getGateway().getProviderUrl(provider),
		get gateway() {
			return getGateway();
		},

		// ── Resumable streaming via WebSocket ───────────────────────────────

		async streamToClient(opts: CompletionOptions): Promise<{ stream_id: string }> {
			const ws = options.ws?.();
			if (!ws) {
				throw createAiError('INTERNAL_ERROR', {
					message: 'WebSocket server not available',
				});
			}

			const streamGen = getGateway().stream(opts);
			const { stream_id, abort } = streamGen;

			// Create buffer
			const buffer: StreamBuffer = {
				stream_id,
				accumulated: '',
				done: false,
				abort,
				created_at: Date.now(),
			};
			streamBuffers.set(stream_id, buffer);
			ensureCleanupInterval();

			// Process stream in the background (non-blocking)
			(async () => {
				try {
					for await (const chunk of streamGen) {
						buffer.accumulated = chunk.accumulated;

						// Only send delta per chunk; send accumulated + metadata on final chunk
						if (chunk.done) {
							ws.broadcast({
								event: 'ai:stream:chunk',
								stream_id,
								delta: chunk.delta,
								accumulated: chunk.accumulated,
								done: true,
								usage: chunk.usage,
								finish_reason: chunk.finish_reason,
								tool_calls: chunk.tool_calls,
							} satisfies AiStreamChunkMessage);
						} else if (chunk.tool_calls?.length) {
							ws.broadcast({
								event: 'ai:stream:chunk',
								stream_id,
								delta: chunk.delta,
								done: false,
								tool_calls: chunk.tool_calls,
							} satisfies AiStreamChunkMessage);
						} else {
							ws.broadcast({
								event: 'ai:stream:chunk',
								stream_id,
								delta: chunk.delta,
								done: false,
							} satisfies AiStreamChunkMessage);
						}

						if (chunk.done) {
							buffer.done = true;
							buffer.abort = null;
						}
					}
				} catch (error: unknown) {
					buffer.done = true;
					buffer.abort = null;

					const code: AiErrorCode =
						(error as { code?: AiErrorCode })?.code ?? 'STREAM_INTERRUPTED';
					const message = error instanceof Error ? error.message : 'Stream interrupted';

					ws.broadcast({
						event: 'ai:stream:error',
						stream_id,
						message,
						code,
					} satisfies AiStreamErrorMessage);
				}

				// Schedule cleanup
				setTimeout(() => cleanBuffers(), BUFFER_TTL);
			})();

			return { stream_id };
		},

		resumeStream(targetWs: WebSocket, stream_id: string, last_offset: number): void {
			const ws = options.ws?.();
			if (!ws) return;

			const buffer = streamBuffers.get(stream_id);
			if (!buffer) return;

			// Replay missed content from the buffer
			const missed = buffer.accumulated.slice(last_offset);
			if (missed) {
				ws.send(targetWs, {
					event: 'ai:stream:chunk',
					stream_id,
					delta: missed,
					accumulated: buffer.accumulated,
					done: buffer.done,
				} satisfies AiStreamChunkMessage);
			} else if (buffer.done) {
				// Stream completed while disconnected — send final signal
				ws.send(targetWs, {
					event: 'ai:stream:chunk',
					stream_id,
					delta: '',
					accumulated: buffer.accumulated,
					done: true,
				} satisfies AiStreamChunkMessage);
			}
			// If stream is still live, new chunks will arrive via normal broadcast
		},

		cancelStream(stream_id: string): void {
			const buffer = streamBuffers.get(stream_id);
			if (buffer?.abort) {
				buffer.abort();
				buffer.done = true;
				buffer.abort = null;
			}
		},

		// ── Embedding pass-through ──────────────────────────────────────────

		scheduleIfChanged: embeddings
			? (et, id, data) => embeddings.scheduleIfChanged(et, id, data)
			: () => Promise.resolve(),
		processAlarm: embeddings ? () => embeddings.processAlarm() : () => Promise.resolve(),
		reembed: embeddings
			? (et, id) => embeddings.reembed(et, id)
			: () => Promise.resolve(),
		backfill: embeddings
			? (et) => embeddings.backfill(et)
			: () => Promise.resolve({ processed: 0, failed: 0 }),
	};
}

// ── WebSocket message handler ───────────────────────────────────────────────

/**
 * Creates an onMessage handler that wires AI-specific WebSocket messages
 * (resume, cancel) to the AiServer automatically.
 *
 * Usage in a WebsocketServer subclass:
 *   const ai = aiProcessing(db, { ... });
 *   const aiMessageHandler = createAiMessageHandler(ai);
 *
 *   super({
 *     onMessage: (msg, session, server) => {
 *       // Handle AI messages first
 *       const handled = aiMessageHandler(msg, session, server);
 *       if (handled) return;
 *
 *       // Handle other messages...
 *     },
 *   }, ctx, env);
 */
export function createAiMessageHandler(ai: AiServer) {
	return (
		msg: { event: string; [key: string]: unknown },
		_session: unknown,
		_server: unknown,
		ws?: WebSocket,
	): boolean => {
		switch (msg.event) {
			case 'ai:stream:resume': {
				if (
					ws &&
					typeof msg.stream_id === 'string' &&
					typeof msg.last_offset === 'number'
				) {
					ai.resumeStream(ws, msg.stream_id, msg.last_offset);
				}
				return true;
			}
			case 'ai:stream:cancel': {
				if (typeof msg.stream_id === 'string') {
					ai.cancelStream(msg.stream_id);
				}
				return true;
			}
			default:
				return false;
		}
	};
}
