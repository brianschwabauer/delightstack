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

// ── AiClient ────────────────────────────────────────────────────────────────

/**
 * Factory for reactive AI completion streams.
 *
 * Each call to `ai.chat(...)` or `ai.complete(...)` returns an independent
 * `ChatStream` — a per-request reactive handle with its own `content`,
 * `streaming`, `error`, `usage`, and an `abort()` method. This lets
 * multiple concurrent completions coexist without clobbering each other's
 * state.
 *
 * Streaming responses arrive over the provided `WebsocketClient` and
 * auto-resume on reconnect.
 *
 * @example
 * ```ts
 * const ai = new AiClient({ ws });
 *
 * const stream = ai.chat({ messages, model });
 * // → stream.streaming, stream.content (reactive)
 *
 * await stream.finished;   // optional — wait for completion
 * stream.abort();          // optional — cancel mid-stream
 * ```
 */
export class AiClient {
	#config: AiClientConfig;

	constructor(config: AiClientConfig) {
		this.#config = config;
	}

	get #apiPath(): string {
		return this.#config.api_path ?? '/api/ai';
	}

	/**
	 * Start a streaming chat completion. Returns a reactive handle that
	 * accumulates chunks into `content` as they arrive. Call `abort()` to
	 * cancel; await `finished` to wait for completion.
	 */
	chat(options: CompletionOptions): ChatStream {
		return new ChatStream(this.#config.ws, this.#apiPath, 'stream', options);
	}

	/**
	 * Run a non-streaming chat completion. The returned handle is still
	 * reactive (use `complete.streaming` / `complete.content`) but the
	 * full response arrives in one step.
	 */
	complete(options: CompletionOptions): ChatStream {
		return new ChatStream(this.#config.ws, this.#apiPath, 'complete', options);
	}
}

// ── ChatStream ──────────────────────────────────────────────────────────────

/**
 * A single in-flight AI completion. Exposes reactive state for templates
 * and an imperative `abort()` method. Cleans up its own WebSocket
 * listeners when the stream ends (done, error, or abort).
 */
export class ChatStream {
	#ws: WebsocketClient;
	#api_path: string;

	#content = $state('');
	#streaming = $state(true);
	#error = $state<string | null>(null);
	#usage = $state<TokenUsage | null>(null);
	#finish_reason = $state<CompletionResult['finish_reason'] | null>(null);
	#tool_calls = $state<ToolCall[]>([]);
	#stream_id = $state<string | null>(null);

	#unsub_chunk: (() => void) | null = null;
	#unsub_error: (() => void) | null = null;
	#unsub_reconnect: (() => void) | null = null;

	#finished_resolve!: () => void;
	/** Resolves when the stream finishes for any reason (done, error, or abort). */
	readonly finished: Promise<void> = new Promise<void>((resolve) => {
		this.#finished_resolve = resolve;
	});

	/** Accumulated response text (reactive). */
	get content(): string {
		return this.#content;
	}
	/** Whether the completion is still in flight (reactive). */
	get streaming(): boolean {
		return this.#streaming;
	}
	/** Error message if the stream failed (reactive). */
	get error(): string | null {
		return this.#error;
	}
	/** Token usage, populated on completion (reactive). */
	get usage(): TokenUsage | null {
		return this.#usage;
	}
	/** Why generation stopped (reactive). */
	get finish_reason(): CompletionResult['finish_reason'] | null {
		return this.#finish_reason;
	}
	/** Tool calls emitted during generation (reactive). */
	get tool_calls(): ToolCall[] {
		return this.#tool_calls;
	}
	/** Server-side stream ID (null until the request is acknowledged). */
	get stream_id(): string | null {
		return this.#stream_id;
	}

	constructor(
		ws: WebsocketClient,
		api_path: string,
		mode: 'stream' | 'complete',
		options: CompletionOptions,
	) {
		this.#ws = ws;
		this.#api_path = api_path;

		if (mode === 'stream') {
			this.#attachStreamListeners();
			void this.#startStream(options);
		} else {
			void this.#runComplete(options);
		}
	}

	/**
	 * Cancel the stream. Resolves the `finished` promise. Safe to call
	 * multiple times or after completion.
	 */
	async abort(): Promise<void> {
		if (!this.#streaming) return;
		const stream_id = this.#stream_id;
		this.#finish('abort');

		if (!stream_id) return;
		try {
			await fetch(`${this.#api_path}/cancel`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stream_id }),
			});
		} catch {
			// Best effort
		}
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	async #startStream(options: CompletionOptions): Promise<void> {
		try {
			const response = await fetch(`${this.#api_path}/stream`, {
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
			this.#stream_id = result.stream_id;
		} catch (err: unknown) {
			this.#error = err instanceof Error ? err.message : 'Failed to start stream';
			this.#finish('error');
		}
	}

	async #runComplete(options: CompletionOptions): Promise<void> {
		try {
			const response = await fetch(`${this.#api_path}/complete`, {
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
			this.#content = result.content;
			this.#usage = result.usage;
			this.#finish_reason = result.finish_reason;
			if (result.tool_calls) this.#tool_calls = result.tool_calls;
			this.#finish('done');
		} catch (err: unknown) {
			this.#error = err instanceof Error ? err.message : 'Completion failed';
			this.#finish('error');
		}
	}

	#attachStreamListeners(): void {
		const ws = this.#ws;

		this.#unsub_chunk = ws.on('ai:stream:chunk', (raw) => {
			const msg = raw as unknown as AiStreamChunkMessage;
			if (msg.stream_id !== this.#stream_id) return;

			if (msg.delta) {
				this.#content += msg.delta;
			}

			if (msg.tool_calls?.length) {
				const updated = [...this.#tool_calls];
				for (const tc of msg.tool_calls) {
					const pos =
						((tc as unknown as Record<string, unknown>).index as number) ??
						updated.length;
					const existing = updated[pos];
					if (existing) {
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
				this.#tool_calls = updated;
			}

			if (msg.done) {
				if (msg.accumulated != null) this.#content = msg.accumulated;
				if (msg.usage) this.#usage = msg.usage;
				if (msg.finish_reason) {
					this.#finish_reason = msg.finish_reason as CompletionResult['finish_reason'];
				}
				this.#finish('done');
			}
		});

		this.#unsub_error = ws.on('ai:stream:error', (raw) => {
			const msg = raw as unknown as AiStreamErrorMessage;
			if (msg.stream_id !== this.#stream_id) return;
			this.#error = msg.message;
			this.#finish('error');
		});

		this.#unsub_reconnect = ws.on('ws:connected', () => {
			if (this.#streaming && this.#stream_id) {
				try {
					this.#ws.send({
						event: 'ai:stream:resume',
						stream_id: this.#stream_id,
						last_offset: this.#content.length,
					});
				} catch {
					// Best effort
				}
			}
		});
	}

	#finish(_reason: 'done' | 'error' | 'abort'): void {
		if (!this.#streaming) return;
		this.#streaming = false;
		this.#unsub_chunk?.();
		this.#unsub_error?.();
		this.#unsub_reconnect?.();
		this.#unsub_chunk = null;
		this.#unsub_error = null;
		this.#unsub_reconnect = null;
		this.#finished_resolve();
	}
}
