import type { WebsocketClient } from '@delightstack/websocket/client';
import type { CompletionOptions, CompletionResult, TokenUsage, ToolCall } from '../types';
import type { AiStreamChunkMessage, AiStreamErrorMessage } from '../types/message.type';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AiClientConfig {
	/** The WebSocket client for receiving stream chunks */
	ws: WebsocketClient;
	/** Base URL for AI API endpoints. Default: '/api/ai' */
	api_path?: string;
}

// ── Client ──────────────────────────────────────────────────────────────────

/**
 * Reactive AI client for Svelte 5.
 *
 * Integrates with WebsocketClient for resumable streaming. The server
 * streams completion chunks over WebSocket, and the client automatically
 * resumes on reconnection.
 *
 * Usage:
 *   const ai = new AiClient({ ws });
 *
 *   // Start a streaming completion
 *   await ai.chat({ messages: [...], model: 'gpt-4o' });
 *
 *   // Reactive state (use in Svelte templates)
 *   {ai.streaming}       // boolean — true while generating
 *   {ai.content}         // string — accumulated text
 *   {ai.error}           // string | null — error message
 *   {ai.usage}           // TokenUsage | null — token counts (after completion)
 *   {ai.finish_reason}   // string | null — why generation stopped
 */
export class AiClient {
	#config: AiClientConfig;
	#unsub_chunk: (() => void) | null = null;
	#unsub_error: (() => void) | null = null;
	#unsub_reconnect: (() => void) | null = null;

	// Reactive state (Svelte 5 runes)
	streaming = $state(false);
	content = $state('');
	error = $state<string | null>(null);
	stream_id = $state<string | null>(null);
	usage = $state<TokenUsage | null>(null);
	finish_reason = $state<CompletionResult['finish_reason'] | null>(null);
	tool_calls = $state<ToolCall[]>([]);

	constructor(config: AiClientConfig) {
		this.#config = config;
		this.#setupListeners();
	}

	/** The API base URL */
	get #apiPath(): string {
		return this.#config.api_path ?? '/api/ai';
	}

	/**
	 * Start a streaming chat completion.
	 *
	 * Sends the request to the server, which starts streaming chunks
	 * back over the WebSocket connection. Previous content is cleared.
	 */
	async chat(options: CompletionOptions): Promise<void> {
		// Reset state
		this.streaming = true;
		this.content = '';
		this.error = null;
		this.stream_id = null;
		this.usage = null;
		this.finish_reason = null;
		this.tool_calls = [];

		try {
			const response = await fetch(`${this.#apiPath}/stream`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(options),
			});

			if (!response.ok) {
				const body = (await response
					.json()
					.catch(() => ({ message: 'Request failed' }))) as { message?: string };
				throw new Error(body.message ?? `HTTP ${response.status}`);
			}

			const result = (await response.json()) as { stream_id: string };
			this.stream_id = result.stream_id;
		} catch (err: unknown) {
			this.streaming = false;
			this.error = err instanceof Error ? err.message : 'Failed to start stream';
		}
	}

	/**
	 * Run a non-streaming chat completion.
	 *
	 * Returns the full result at once. Updates reactive state.
	 */
	async complete(options: CompletionOptions): Promise<void> {
		this.streaming = true;
		this.content = '';
		this.error = null;
		this.stream_id = null;
		this.usage = null;
		this.finish_reason = null;
		this.tool_calls = [];

		try {
			const response = await fetch(`${this.#apiPath}/complete`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(options),
			});

			if (!response.ok) {
				const body = (await response
					.json()
					.catch(() => ({ message: 'Request failed' }))) as { message?: string };
				throw new Error(body.message ?? `HTTP ${response.status}`);
			}

			const result = (await response.json()) as CompletionResult;

			this.content = result.content;
			this.usage = result.usage;
			this.finish_reason = result.finish_reason;
			if (result.tool_calls) this.tool_calls = result.tool_calls;
		} catch (err: unknown) {
			this.error = err instanceof Error ? err.message : 'Completion failed';
		} finally {
			this.streaming = false;
		}
	}

	/**
	 * Cancel the current stream.
	 */
	async cancel(): Promise<void> {
		if (!this.stream_id) return;

		const stream_id = this.stream_id;
		this.stream_id = null;
		this.streaming = false;

		try {
			await fetch(`${this.#apiPath}/cancel`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stream_id }),
			});
		} catch {
			// Best effort
		}
	}

	/**
	 * Clean up all listeners. Call when the component is destroyed.
	 */
	destroy(): void {
		this.#unsub_chunk?.();
		this.#unsub_error?.();
		this.#unsub_reconnect?.();
		this.#unsub_chunk = null;
		this.#unsub_error = null;
		this.#unsub_reconnect = null;
	}

	// ── Private ─────────────────────────────────────────────────────────────

	#setupListeners(): void {
		const ws = this.#config.ws;

		// Listen for stream chunks
		this.#unsub_chunk = ws.on('ai:stream:chunk', (raw) => {
			const msg = raw as unknown as AiStreamChunkMessage;
			if (msg.stream_id !== this.stream_id) return;

			// Accumulate from delta (server only sends delta per chunk)
			if (msg.delta) {
				this.content += msg.delta;
			}

			// Merge streaming tool call deltas by index
			if (msg.tool_calls?.length) {
				const updated = [...this.tool_calls];
				for (const tc of msg.tool_calls) {
					// Streaming deltas include an `index` for positional merging
					const pos =
						((tc as unknown as Record<string, unknown>).index as number) ??
						updated.length;
					const existing = updated[pos];
					if (existing) {
						// Merge delta into existing entry (append argument fragments)
						updated[pos] = {
							id: tc.id || existing.id,
							type: tc.type || existing.type,
							function: {
								name: tc.function?.name || existing.function.name,
								arguments:
									existing.function.arguments +
									(tc.function?.arguments ?? ''),
							},
						};
					} else {
						// First chunk for this tool call
						updated[pos] = {
							id: tc.id ?? '',
							type: tc.type ?? 'function',
							function: {
								name: tc.function?.name ?? '',
								arguments: tc.function?.arguments ?? '',
							},
						};
					}
				}
				this.tool_calls = updated;
			}

			if (msg.done) {
				// On final chunk, server sends accumulated — use it for consistency
				if (msg.accumulated != null) {
					this.content = msg.accumulated;
				}
				this.streaming = false;
				if (msg.usage) this.usage = msg.usage;
				if (msg.finish_reason) {
					this.finish_reason = msg.finish_reason as CompletionResult['finish_reason'];
				}
			}
		});

		// Listen for stream errors
		this.#unsub_error = ws.on('ai:stream:error', (raw) => {
			const msg = raw as unknown as AiStreamErrorMessage;
			if (msg.stream_id !== this.stream_id) return;

			this.error = msg.message;
			this.streaming = false;
		});

		// Auto-resume on WebSocket reconnection
		this.#unsub_reconnect = ws.on('ws:connected', () => {
			if (this.streaming && this.stream_id) {
				this.#resume();
			}
		});
	}

	#resume(): void {
		if (!this.stream_id) return;

		try {
			this.#config.ws.send({
				event: 'ai:stream:resume',
				stream_id: this.stream_id,
				last_offset: this.content.length,
			});
		} catch {
			// Best effort — WS may not be ready yet
		}
	}
}
