import type { WebsocketClient } from '@delightstack/websocket/client';
import type { CompletionOptions, TokenUsage } from '../types';
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
 *   {ai.streaming}   // boolean — true while generating
 *   {ai.content}     // string — accumulated text
 *   {ai.error}       // string | null — error message
 *   {ai.usage}       // TokenUsage | null — token counts (after completion)
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

			const result = (await response.json()) as {
				content: string;
				usage: TokenUsage;
			};

			this.content = result.content;
			this.usage = result.usage;
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

		try {
			await fetch(`${this.#apiPath}/cancel`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stream_id: this.stream_id }),
			});
		} catch {
			// Best effort
		}

		this.streaming = false;
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

			this.content = msg.accumulated;

			if (msg.done) {
				this.streaming = false;
				if (msg.usage) this.usage = msg.usage;
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

	async #resume(): Promise<void> {
		if (!this.stream_id) return;

		// Send resume request via WebSocket message
		this.#config.ws.send({
			event: 'ai:stream:resume',
			stream_id: this.stream_id,
			last_offset: this.content.length,
		});
	}
}
