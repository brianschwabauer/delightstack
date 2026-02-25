import { generateTimestampID } from '@delightstack/utilities';
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
	EmbeddingFieldConfig,
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
	stream(
		options: CompletionOptions,
	): AsyncGenerator<StreamChunk, void, unknown> & {
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
	const gateway = createAiGateway({
		ai: options.ai(),
		gateway: options.gateway,
	});

	const embeddings = options.fields?.length
		? aiEmbeddings(db, { ...options, fields: options.fields })
		: null;

	// In-memory stream buffers for resumability
	const streamBuffers = new Map<string, StreamBuffer>();

	/** Clean up expired stream buffers */
	function cleanBuffers(): void {
		const now = Date.now();
		for (const [id, buffer] of streamBuffers) {
			if (buffer.done && now - buffer.created_at > BUFFER_TTL) {
				streamBuffers.delete(id);
			}
		}
	}

	return {
		// ── Gateway pass-through ────────────────────────────────────────────

		complete: (opts) => gateway.complete(opts),
		stream: (opts) => gateway.stream(opts),
		embed: (opts) => gateway.embed(opts),
		getProviderUrl: (provider) => gateway.getProviderUrl(provider),
		gateway,

		// ── Resumable streaming via WebSocket ───────────────────────────────

		async streamToClient(opts: CompletionOptions): Promise<{ stream_id: string }> {
			const ws = options.ws?.();
			if (!ws) {
				throw createAiError('INTERNAL_ERROR', {
					message: 'WebSocket server not available',
				});
			}

			const streamGen = gateway.stream(opts);
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

			// Process stream in the background (non-blocking)
			(async () => {
				try {
					for await (const chunk of streamGen) {
						buffer.accumulated = chunk.accumulated;

						ws.broadcast({
							event: 'ai:stream:chunk',
							stream_id,
							delta: chunk.delta,
							accumulated: chunk.accumulated,
							done: chunk.done,
							usage: chunk.usage,
							finish_reason: chunk.finish_reason,
						} satisfies AiStreamChunkMessage);

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
