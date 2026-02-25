import { generateTimestampID } from '@delightstack/utilities';
import type {
	CompletionOptions,
	CompletionResult,
	StreamChunk,
	EmbeddingOptions,
	EmbeddingResult,
	TokenUsage,
	ConversationMessage,
} from '../types';
import { createAiError } from './ai.errors';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AiGatewayOptions {
	/** Cloudflare AI binding */
	ai: Ai;
	/** AI Gateway name. When set, requests are proxied through the gateway. */
	gateway?: string;
}

export interface AiGatewayClient {
	/** Non-streaming chat completion */
	complete(options: CompletionOptions): Promise<CompletionResult>;
	/** Streaming chat completion. Returns an async iterable of chunks. */
	stream(options: CompletionOptions): AsyncGenerator<StreamChunk, void, unknown> & {
		stream_id: string;
		abort: () => void;
	};
	/** Generate embeddings */
	embed(options: EmbeddingOptions): Promise<EmbeddingResult>;
	/** Get the gateway base URL for a specific provider's SDK */
	getProviderUrl(provider: string): Promise<string>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build the messages array with optional system prompt prepended */
function buildMessages(options: CompletionOptions): ConversationMessage[] {
	const messages = [...options.messages];
	if (options.system && !messages.some((m) => m.role === 'system')) {
		messages.unshift({ role: 'system', content: options.system });
	}
	return messages;
}

/** Parse an SSE line into a data string, or null if not a data line */
function parseSSELine(line: string): string | null {
	if (line.startsWith('data: ')) return line.slice(6);
	return null;
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an AI Gateway client that wraps the Cloudflare AI binding.
 *
 * Supports Workers AI models directly and external providers (OpenAI,
 * Anthropic, etc.) via AI Gateway's unified `/compat/chat/completions`
 * endpoint. Dynamic routing models use the `dynamic/` prefix.
 *
 * Usage:
 *   const gateway = createAiGateway({ ai: env.AI, gateway: 'my-gateway' });
 *
 *   // Non-streaming
 *   const result = await gateway.complete({ messages: [...], model: 'gpt-4o' });
 *
 *   // Streaming
 *   for await (const chunk of gateway.stream({ messages: [...], model: 'gpt-4o' })) {
 *     console.log(chunk.delta);
 *   }
 *
 *   // Embeddings
 *   const embedding = await gateway.embed({ input: 'hello world' });
 *
 *   // Get URL for external SDK
 *   const baseUrl = await gateway.getProviderUrl('openai');
 *   const openai = new OpenAI({ apiKey: env.OPENAI_KEY, baseURL: baseUrl });
 */
export function createAiGateway(options: AiGatewayOptions): AiGatewayClient {
	const { ai, gateway } = options;

	function getGateway() {
		if (!gateway) return null;
		return ai.gateway(gateway);
	}

	/**
	 * Build the request body in OpenAI-compatible format.
	 * This is the format accepted by the AI Gateway `/compat/chat/completions` endpoint.
	 */
	function buildRequestBody(
		opts: CompletionOptions,
		streaming: boolean,
	): Record<string, unknown> {
		const body: Record<string, unknown> = {
			model: opts.model,
			messages: buildMessages(opts),
			stream: streaming,
		};
		if (opts.max_tokens != null) body.max_tokens = opts.max_tokens;
		if (opts.temperature != null) body.temperature = opts.temperature;
		if (opts.top_p != null) body.top_p = opts.top_p;
		if (opts.tools?.length) body.tools = opts.tools;
		if (opts.response_format) body.response_format = opts.response_format;
		if (opts.user_id) body.user = opts.user_id;
		if (opts.metadata) body.metadata = opts.metadata;
		return body;
	}

	/** Build Workers AI run options from CompletionOptions */
	function buildWorkersAiBody(
		opts: CompletionOptions,
		streaming: boolean,
	): Record<string, unknown> {
		const body: Record<string, unknown> = {
			messages: buildMessages(opts).map((m) => ({ role: m.role, content: m.content })),
			stream: streaming,
		};
		if (opts.max_tokens != null) body.max_tokens = opts.max_tokens;
		if (opts.temperature != null) body.temperature = opts.temperature;
		if (opts.top_p != null) body.top_p = opts.top_p;
		if (opts.tools?.length) body.tools = opts.tools;
		if (opts.response_format) body.response_format = opts.response_format;
		return body;
	}

	/**
	 * Make a request through the AI Gateway's unified compat endpoint.
	 * Falls back to the gateway.run() binding method.
	 */
	async function gatewayFetch(
		opts: CompletionOptions,
		streaming: boolean,
	): Promise<Response> {
		const gw = getGateway();
		if (!gw) {
			throw createAiError('GATEWAY_ERROR', { message: 'No gateway configured' });
		}

		const body = buildRequestBody(opts, streaming);

		const response = (await gw.run({
			provider: 'compat',
			endpoint: 'chat/completions',
			headers: { 'Content-Type': 'application/json' },
			query: body as Record<string, string>,
		})) as unknown as Response;

		return response;
	}

	/**
	 * Check if a model is a Workers AI model (prefixed with @cf/).
	 * Workers AI models are run directly via env.AI.run() rather than
	 * going through the gateway compat endpoint.
	 */
	function isWorkersAiModel(model: string): boolean {
		return model.startsWith('@cf/');
	}

	return {
		async complete(opts: CompletionOptions): Promise<CompletionResult> {
			// Workers AI models can be called directly
			if (isWorkersAiModel(opts.model)) {
				const gatewayOpts = gateway ? { gateway: { id: gateway } } : undefined;

				const result = (await ai.run(
					opts.model as Parameters<Ai['run']>[0],
					buildWorkersAiBody(opts, false),
					gatewayOpts,
				)) as Record<string, unknown>;

				return {
					content: (result.response as string) ?? '',
					finish_reason: 'stop',
					usage: {
						prompt_tokens: 0,
						completion_tokens: 0,
						total_tokens: 0,
					},
					model: opts.model,
					log_id: ai.aiGatewayLogId ?? undefined,
				};
			}

			// External models via gateway compat endpoint
			const response = await gatewayFetch(opts, false);

			if (!response.ok) {
				const error = await response.text().catch(() => 'Unknown error');
				throw createAiError('PROVIDER_ERROR', {
					status: response.status,
					message: error,
				});
			}

			const json = (await response.json()) as Record<string, unknown>;
			const choice = (json.choices as Record<string, unknown>[])?.[0] ?? {};
			const message = choice.message as Record<string, unknown> | undefined;
			const usage = json.usage as TokenUsage | undefined;

			return {
				content: (message?.content as string) ?? '',
				finish_reason:
					(choice.finish_reason as CompletionResult['finish_reason']) ?? 'stop',
				tool_calls: message?.tool_calls as CompletionResult['tool_calls'],
				usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
				model: (json.model as string) ?? opts.model,
				log_id: response.headers.get('cf-aig-log-id') ?? undefined,
			};
		},

		stream(opts: CompletionOptions) {
			const stream_id = generateTimestampID();
			const controller = new AbortController();
			let accumulated = '';

			async function* generate(): AsyncGenerator<StreamChunk, void, unknown> {
				// Workers AI streaming
				if (isWorkersAiModel(opts.model)) {
					const gatewayOpts = gateway ? { gateway: { id: gateway } } : undefined;

					const result = await ai.run(
						opts.model as Parameters<Ai['run']>[0],
						buildWorkersAiBody(opts, true),
						gatewayOpts,
					);

					// Workers AI streaming returns a ReadableStream
					const stream = result as unknown as ReadableStream<Uint8Array>;
					const decoder = new TextDecoderStream();
					const pipePromise = stream.pipeTo(
						decoder.writable as WritableStream<Uint8Array>,
					);
					pipePromise.catch(() => {}); // Errors surface via reader
					const reader = decoder.readable.getReader();

					let buffer = '';
					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;

							buffer += value;
							const lines = buffer.split('\n');
							buffer = lines.pop() ?? '';

							for (const line of lines) {
								const data = parseSSELine(line.trim());
								if (!data || data === '[DONE]') continue;

								try {
									const parsed = JSON.parse(data) as Record<string, unknown>;
									const delta = (parsed.response as string) ?? '';
									if (!delta) continue;

									accumulated += delta;
									yield {
										delta,
										accumulated,
										done: false,
									};
								} catch {
									// Skip malformed chunks
								}
							}
						}
					} finally {
						reader.releaseLock();
					}

					yield {
						delta: '',
						accumulated,
						done: true,
						finish_reason: 'stop',
					};
					return;
				}

				// External models via gateway
				const response = await gatewayFetch({ ...opts, signal: controller.signal }, true);

				if (!response.ok) {
					const error = await response.text().catch(() => 'Unknown error');
					throw createAiError('PROVIDER_ERROR', {
						status: response.status,
						message: error,
					});
				}

				const body = response.body;
				if (!body) {
					throw createAiError('PROVIDER_ERROR', { message: 'Empty response body' });
				}

				const bodyDecoder = new TextDecoderStream();
				const pipePromise = body.pipeTo(
					bodyDecoder.writable as WritableStream<Uint8Array>,
				);
				pipePromise.catch(() => {}); // Errors surface via reader
				const reader = bodyDecoder.readable.getReader();
				let buffer = '';
				let lastUsage: TokenUsage | undefined;
				let lastFinishReason: CompletionResult['finish_reason'] | undefined;

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;

						buffer += value;
						const lines = buffer.split('\n');
						buffer = lines.pop() ?? '';

						for (const line of lines) {
							const data = parseSSELine(line.trim());
							if (!data) continue;
							if (data === '[DONE]') continue;

							try {
								const parsed = JSON.parse(data) as Record<string, unknown>;
								const choices = parsed.choices as Record<string, unknown>[] | undefined;
								const choice = choices?.[0];
								if (!choice) continue;

								const delta = choice.delta as Record<string, unknown> | undefined;
								const content = (delta?.content as string) ?? '';
								const finish = choice.finish_reason as
									| CompletionResult['finish_reason']
									| null;

								if (parsed.usage) lastUsage = parsed.usage as TokenUsage;
								if (finish) lastFinishReason = finish;

								if (content) {
									accumulated += content;
									yield {
										delta: content,
										accumulated,
										done: false,
										tool_calls: delta?.tool_calls as StreamChunk['tool_calls'],
									};
								}
							} catch {
								// Skip malformed chunks
							}
						}
					}
				} finally {
					reader.releaseLock();
				}

				yield {
					delta: '',
					accumulated,
					done: true,
					usage: lastUsage,
					finish_reason: lastFinishReason ?? 'stop',
				};
			}

			const gen = generate();
			return Object.assign(gen, {
				stream_id,
				abort: () => controller.abort(),
			});
		},

		async embed(opts: EmbeddingOptions): Promise<EmbeddingResult> {
			const model = opts.model ?? '@cf/baai/bge-base-en-v1.5';
			const inputs = Array.isArray(opts.input) ? opts.input : [opts.input];
			const gatewayOpts = gateway ? { gateway: { id: gateway } } : undefined;

			// Workers AI embedding models
			if (model.startsWith('@cf/')) {
				const result = (await ai.run(
					model as Parameters<Ai['run']>[0],
					{
						text: inputs,
					} as Record<string, unknown>,
					gatewayOpts,
				)) as Record<string, unknown>;

				const data = result.data as number[][] | undefined;
				if (!data) {
					throw createAiError('EMBEDDING_FAILED', {
						message: 'No embedding data returned',
					});
				}

				return {
					vectors: data,
					model,
					usage: { prompt_tokens: 0, total_tokens: 0 },
				};
			}

			// External embedding models via gateway
			const gw = getGateway();
			if (!gw) {
				throw createAiError('GATEWAY_ERROR', {
					message: 'No gateway configured for external embedding model',
				});
			}

			const response = (await gw.run({
				provider: 'compat',
				endpoint: 'embeddings',
				headers: { 'Content-Type': 'application/json' },
				query: {
					model,
					input: inputs,
				} as unknown as Record<string, string>,
			})) as unknown as Response;

			if (!response.ok) {
				const error = await response.text().catch(() => 'Unknown error');
				throw createAiError('EMBEDDING_FAILED', {
					status: response.status,
					message: error,
				});
			}

			const json = (await response.json()) as Record<string, unknown>;
			const embeddings =
				(json.data as { embedding: number[] }[])?.map((d) => d.embedding) ?? [];
			const usage = json.usage as
				| { prompt_tokens: number; total_tokens: number }
				| undefined;

			return {
				vectors: embeddings,
				model,
				usage: usage ?? { prompt_tokens: 0, total_tokens: 0 },
			};
		},

		async getProviderUrl(provider: string): Promise<string> {
			const gw = getGateway();
			if (!gw) {
				throw createAiError('GATEWAY_ERROR', { message: 'No gateway configured' });
			}
			return gw.getUrl(provider);
		},
	};
}
