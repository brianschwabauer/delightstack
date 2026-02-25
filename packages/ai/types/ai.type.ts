// ── Message roles & conversation ─────────────────────────────────────────────

/** Role in a conversation message */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A single message in a conversation */
export interface ConversationMessage {
	role: MessageRole;
	content: string;
	/** Tool call ID (for tool responses) */
	tool_call_id?: string;
	/** Tool calls requested by the assistant */
	tool_calls?: ToolCall[];
}

/** Tool call from the assistant */
export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

/** Tool definition for function calling */
export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

// ── Completion options ──────────────────────────────────────────────────────

/** Options for a chat completion request */
export interface CompletionOptions {
	/** Messages in the conversation */
	messages: ConversationMessage[];

	/**
	 * Model identifier. When using AI Gateway dynamic routing,
	 * prefix with 'dynamic/' to use dashboard-configured routes.
	 * e.g. 'gpt-4o', 'claude-sonnet-4-20250514', 'dynamic/my-route'
	 */
	model: string;

	/** Maximum tokens to generate */
	max_tokens?: number;

	/** Temperature (0-2). Default: 1 */
	temperature?: number;

	/** Top-p nucleus sampling. Default: 1 */
	top_p?: number;

	/** System prompt (prepended as a system message if not already present) */
	system?: string;

	/** Tool definitions for function calling */
	tools?: ToolDefinition[];

	/** Response format */
	response_format?: { type: 'text' } | { type: 'json_object' };

	/** Metadata passed to AI Gateway for logging/analytics/conditional routing */
	metadata?: Record<string, string>;

	/** User ID for AI Gateway per-user tracking */
	user_id?: string;

	/** Abort signal for cancellation */
	signal?: AbortSignal;
}

/** Non-streaming completion result */
export interface CompletionResult {
	/** Generated text content */
	content: string;
	/** Why generation stopped */
	finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
	/** Tool calls if any */
	tool_calls?: ToolCall[];
	/** Token usage */
	usage: TokenUsage;
	/** The model that actually served the request (may differ when using dynamic routes) */
	model: string;
	/** AI Gateway log ID for tracing */
	log_id?: string;
}

/** Token usage statistics */
export interface TokenUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

// ── Streaming types ─────────────────────────────────────────────────────────

/** A single chunk in a streaming response */
export interface StreamChunk {
	/** Incremental text content */
	delta: string;
	/** Accumulated text so far */
	accumulated: string;
	/** Whether this is the final chunk */
	done: boolean;
	/** Token usage (only on final chunk) */
	usage?: TokenUsage;
	/** Finish reason (only on final chunk) */
	finish_reason?: CompletionResult['finish_reason'];
	/** Incremental tool call deltas */
	tool_calls?: ToolCall[];
}

// ── Embedding types ─────────────────────────────────────────────────────────

/** Options for generating embeddings */
export interface EmbeddingOptions {
	/** Text to embed (single string or batch) */
	input: string | string[];
	/** Embedding model. Default: '@cf/baai/bge-base-en-v1.5' */
	model?: string;
}

/** Result of an embedding request */
export interface EmbeddingResult {
	/** The embedding vectors */
	vectors: number[][];
	/** The model used */
	model: string;
	/** Token usage */
	usage: { prompt_tokens: number; total_tokens: number };
}

// ── Embedding processing status ─────────────────────────────────────────────

export type EmbeddingStatus = 'pending' | 'processing' | 'embedded' | 'failed';

// ── Error codes ─────────────────────────────────────────────────────────────

export type AiErrorCode =
	| 'PROVIDER_ERROR'
	| 'GATEWAY_ERROR'
	| 'RATE_LIMITED'
	| 'MODEL_NOT_FOUND'
	| 'CONTEXT_TOO_LONG'
	| 'CONTENT_FILTERED'
	| 'STREAM_INTERRUPTED'
	| 'EMBEDDING_FAILED'
	| 'INTERNAL_ERROR';

// ── Factory options ─────────────────────────────────────────────────────────

/** Configuration for which fields to embed for a given entity type */
export interface EmbeddingFieldConfig {
	/** Entity type (table name) in the database */
	entity_type: string;
	/**
	 * Fields whose values are concatenated to form the embedding source text.
	 * e.g. ['title', 'body', 'tags']
	 */
	source_fields: string[];
	/** Separator between field values. Default: '\n' */
	separator?: string;
	/** Custom text extraction function (overrides source_fields concatenation) */
	extractText?: (record: Record<string, unknown>) => string;
}

/** Options for the aiProcessing() factory */
export interface AiProcessingOptions {
	/** AI binding from the Cloudflare Workers environment */
	ai: () => Ai;

	/** AI Gateway name. When set, requests are proxied through the gateway. */
	gateway?: string;

	/** The Durable Object storage for alarm scheduling. Required when `fields` is provided. */
	storage?: DurableObjectStorage;

	/** Default embedding model. Default: '@cf/baai/bge-base-en-v1.5' */
	embedding_model?: string;

	/** Maximum retries for failed embedding jobs. Default: 5 */
	max_retries?: number;

	/** Embedding field configurations */
	fields?: EmbeddingFieldConfig[];
}

// ── Reserved field names ────────────────────────────────────────────────────

/** Fields managed by the AI package — cannot be overridden in custom schemas */
export const RESERVED_AI_FIELDS = new Set([
	'id',
	'embedding',
	'embedding_status',
	'embedding_error',
	'embedding_model',
	'_embedding_source',
	'created_at',
	'updated_at',
] as const);

export type ReservedAiField = typeof RESERVED_AI_FIELDS extends Set<infer T> ? T : never;

// ── Minimal SvelteKit types ─────────────────────────────────────────────────

/** Minimal SvelteKit-compatible request event (avoids hard dependency on @sveltejs/kit) */
export interface RequestEventLike {
	url: URL;
	request: Request;
	locals: Record<string, unknown>;
	platform?: Record<string, unknown>;
	[key: string]: unknown;
}
