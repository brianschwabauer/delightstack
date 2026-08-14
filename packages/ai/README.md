# @delightstack/ai

AI integration for SvelteKit apps on Cloudflare Workers. Chat completions, resumable streaming, vector embeddings, and tool calling — all routed through Cloudflare AI Gateway with automatic database integration and WebSocket delivery.

## Features

- **Chat completions** — Non-streaming and streaming completions via Cloudflare AI Gateway. Supports Workers AI models (`@cf/` prefix), OpenAI, Anthropic, and any provider accessible through AI Gateway
- **Resumable streaming** — Stream chunks are buffered in memory and broadcast over WebSocket. On reconnect, the client automatically resumes from its last offset — no lost tokens
- **Vector embeddings** — Alarm-based async embedding pipeline. Define source fields per entity type, and embeddings are generated automatically on create/update with change detection
- **Tool calling** — Full OpenAI-compatible function calling with streaming delta merging for tool call arguments
- **Schema helpers** — `defineAiTable()` and `defineAiConversationTable()` extend `@delightstack/database` schemas with embedding and conversation fields
- **SvelteKit Handle** — `createAiHandle()` exposes `/api/ai/complete`, `/api/ai/stream`, `/api/ai/embed`, and `/api/ai/cancel` with authorization and model validation
- **Reactive client** — Svelte 5 `AiClient` class with `$state` runes for streaming content, errors, usage, and tool calls
- **WebSocket message handler** — `createAiMessageHandler()` wires resume and cancel messages into your WebSocket server

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  AiClient (Svelte 5 runes)                                  │    │
│  │  • chat() → POST /api/ai/stream → receives chunks via WS    │    │
│  │  • complete() → POST /api/ai/complete → full result         │    │
│  │  • cancel() → POST /api/ai/cancel                           │    │
│  │  • Auto-resume on WS reconnect (sends last_offset)          │    │
│  └──────────────────────────────┬──────────────────────────────┘    │
│                                 │ WebSocket                         │
└─────────────────────────────────┼───────────────────────────────────┘
                                  │
┌─────────────────────────────────┼───────────────────────────────────┐
│  Cloudflare Worker              │                                   │
│                                 ▼                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  createAiHandle()                                            │   │
│  │  POST /api/ai/complete  → ai.complete()                      │   │
│  │  POST /api/ai/stream    → ai.streamToClient()                │   │
│  │  POST /api/ai/embed     → ai.embed()                         │   │
│  │  POST /api/ai/cancel    → ai.cancelStream()                  │   │
│  └──────────────────────────────┬───────────────────────────────┘   │
│                                 │                                   │
│  ┌──────────────────────────────▼───────────────────────────────┐   │
│  │  aiProcessing() — Server Factory                             │   │
│  │                                                              │   │
│  │  ┌────────────────────┐  ┌───────────────────────────────┐   │   │
│  │  │  AI Gateway Client │  │  Embedding Processor          │   │   │
│  │  │  • complete()      │  │  • scheduleIfChanged()        │   │   │
│  │  │  • stream()        │  │  • processAlarm()             │   │   │
│  │  │  • embed()         │  │  • reembed() / backfill()     │   │   │
│  │  └────────┬───────────┘  └───────────────┬───────────────┘   │   │
│  │           │                              │                   │   │
│  │           ▼                              ▼                   │   │
│  │  ┌─────────────────┐           ┌─────────────────┐           │   │
│  │  │  AI Gateway /   │           │  DO Alarm       │           │   │
│  │  │  Workers AI     │           │  (async embed)  │           │   │
│  │  └─────────────────┘           └─────────────────┘           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                    │                           │                    │
│                    ▼                           ▼                    │
│           ┌────────────────┐         ┌─────────────────┐            │
│           │  WebSocket DO  │         │  Database DO    │            │
│           │  (broadcast)   │         │  (SQLite)       │            │
│           └────────────────┘         └─────────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
```

**Dual delivery model:** Non-streaming completions return directly as HTTP responses. Streaming completions return a `stream_id` over HTTP, then deliver chunks over WebSocket. This allows the stream to survive page transitions and network interruptions.

**In-memory stream buffers:** Active streams are buffered in the Durable Object's memory (not storage), with TTLs of 30 minutes for active streams and 5 minutes for completed ones. A cap of 100 concurrent buffers prevents runaway memory usage.

**Alarm-based embeddings:** When a record's source text changes (detected via djb2 hash), it's marked as `pending` and a Durable Object alarm is scheduled. The alarm processes up to 10 records per cycle, with retry tracking and automatic rescheduling for remaining work.

## Quickstart

### 1. Define your schema

```typescript
import { defineAiTable, defineAiConversationTable } from '@delightstack/ai/schema';

const articleTable = defineAiTable('article', (schema) => ({
	title: schema.string().searchable(),
	body: schema.string(),
	author_id: schema.string(),
	tags: schema.array(schema.string()).optional(),
}));

// Optional: conversation history table
const conversationTable = defineAiConversationTable((schema) => ({
	user_id: schema.string(),
	title: schema.string().searchable(),
}));
```

`defineAiTable()` adds these fields automatically: `id`, `embedding`, `embedding_status`, `embedding_error`, `embedding_model`, `_embedding_source`, `created_at`, `updated_at`. Custom fields must not collide with these reserved names.

### 2. Set up the server (Durable Object)

```typescript
import { DatabaseServer } from '@delightstack/database';
import { aiProcessing, createAiMessageHandler } from '@delightstack/ai/server';
import { WebsocketServer } from '@delightstack/websocket/server';

const tables = { article: articleTable };

export class MyDatabase extends DatabaseServer<typeof tables> {
	#ai: AiServer;

	constructor(ctx: DurableObjectState, env: Env) {
		super(tables, () => env.WEBSOCKET, ctx, env);

		this.#ai = aiProcessing(this, {
			ai: () => env.AI,
			gateway: 'my-gateway',
			storage: ctx.storage,
			ws: () => this.getWebsocket(),
			fields: [{ entity_type: 'article', source_fields: ['title', 'body', 'tags'] }],
		});
	}

	// Process embedding jobs
	async alarm() {
		await this.#ai.processAlarm();
	}
}
```

### 3. Wire the SvelteKit Handle

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createAiHandle } from '@delightstack/ai/server';

const aiHandle = createAiHandle({
	getAi: (event) => event.locals.ai,
	authorize: (event) => !!event.locals.session,
	validateModel: (model) => !model.startsWith('dynamic/admin'),
});

export const handle = sequence(authHandle, websocketHandle, aiHandle);
```

### 4. Connect from the client

```typescript
import { AiClient } from '@delightstack/ai/client';
import { ws } from '$lib/websocket';

const ai = new AiClient({ ws });
```

```svelte
<script>
	import { ai } from '$lib/ai';

	let prompt = $state('');

	async function send() {
		await ai.chat({
			messages: [{ role: 'user', content: prompt }],
			model: 'gpt-4o',
		});
	}
</script>

<input bind:value={prompt} />
<button onclick={send} disabled={ai.streaming}>Send</button>

{#if ai.streaming}
	<p>
		{ai.content}
		<span class="cursor">▌</span>
	</p>
{:else if ai.content}
	<p>{ai.content}</p>
{/if}

{#if ai.error}
	<p class="error">{ai.error}</p>
{/if}

{#if ai.usage}
	<p>{ai.usage.total_tokens} tokens</p>
{/if}
```

## Server

### aiProcessing()

The main entry point. Composes the AI Gateway client and embedding processor into a single `AiServer` interface.

```typescript
const ai = aiProcessing(db, {
	// Required: Cloudflare AI binding (lazy for construction-time safety)
	ai: () => env.AI,

	// AI Gateway name (enables external provider routing)
	gateway: 'my-gateway',

	// DO storage for alarm scheduling (required when fields is set)
	storage: ctx.storage,

	// WebSocket server for stream broadcasting (required for streamToClient)
	ws: () => this.getWebsocket(),

	// Embedding configs per entity type
	fields: [
		{ entity_type: 'article', source_fields: ['title', 'body'] },
		{
			entity_type: 'product',
			source_fields: ['name', 'description'],
			separator: ' — ',
		},
		{
			entity_type: 'review',
			extractText: (record) => `${record.title}: ${record.body}`,
		},
	],

	// Default embedding model (default: '@cf/baai/bge-base-en-v1.5')
	embedding_model: '@cf/baai/bge-base-en-v1.5',

	// Max retries for failed embedding jobs (default: 5)
	max_retries: 5,
});
```

### AiServer API

| Method                | Signature                                                     | Description                                                                            |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **complete**          | `(options: CompletionOptions) => Promise<CompletionResult>`   | Non-streaming chat completion                                                          |
| **stream**            | `(options: CompletionOptions) => AsyncGenerator<StreamChunk>` | Streaming completion (async iterable). Returns object with `.stream_id` and `.abort()` |
| **embed**             | `(options: EmbeddingOptions) => Promise<EmbeddingResult>`     | Generate embeddings directly                                                           |
| **getProviderUrl**    | `(provider: string) => Promise<string>`                       | Get gateway base URL for external SDK integration                                      |
| **streamToClient**    | `(options: CompletionOptions) => Promise<{ stream_id }>`      | Stream via WebSocket with in-memory buffering for resumability                         |
| **resumeStream**      | `(stream_id, last_offset) => AiStreamChunkMessage \| null`    | Replay missed chunks from buffer                                                       |
| **cancelStream**      | `(stream_id) => void`                                         | Abort an active stream                                                                 |
| **scheduleIfChanged** | `(entity_type, id, data) => Promise<void>`                    | Check for embedding source change, schedule if needed                                  |
| **processAlarm**      | `() => Promise<void>`                                         | Process pending embedding jobs (call from DO alarm)                                    |
| **reembed**           | `(entity_type, id) => Promise<void>`                          | Force re-embed a specific record                                                       |
| **backfill**          | `(entity_type) => Promise<{ processed, failed }>`             | Embed all un-embedded records of an entity type                                        |

### createAiGateway()

Lower-level gateway client if you need direct access without the full `aiProcessing` factory.

```typescript
const gateway = createAiGateway({ ai: env.AI, gateway: 'my-gateway' });

// Non-streaming
const result = await gateway.complete({
	messages: [{ role: 'user', content: 'Hello' }],
	model: 'gpt-4o',
});

// Streaming
for await (const chunk of gateway.stream({ messages, model: 'gpt-4o' })) {
	console.log(chunk.delta);
}

// Embeddings
const embedding = await gateway.embed({ input: 'hello world' });

// Get URL for external SDK (e.g. OpenAI SDK)
const baseUrl = await gateway.getProviderUrl('openai');
const openai = new OpenAI({ apiKey: env.OPENAI_KEY, baseURL: baseUrl });
```

**Model routing:** Models prefixed with `@cf/` are run directly via Workers AI (`env.AI.run()`). All other models (including `dynamic/` prefixed models) are routed through AI Gateway's unified `/compat/chat/completions` endpoint.

### createAiHandle()

SvelteKit Handle that exposes AI endpoints over HTTP.

| Option          | Type                               | Default            | Description                           |
| --------------- | ---------------------------------- | ------------------ | ------------------------------------- |
| `path`          | `string`                           | `'/api/ai'`        | Path prefix for AI routes             |
| `getAi`         | `(event) => AiServer \| undefined` | —                  | Returns the AI server for the request |
| `authorize`     | `(event) => boolean`               | `!!locals.session` | Authorization check                   |
| `validateModel` | `(model, event) => boolean`        | allows all         | Restrict which models clients can use |

**Routes:**

| Method | Path               | Description                                                   |
| ------ | ------------------ | ------------------------------------------------------------- |
| `POST` | `/api/ai/complete` | Non-streaming completion → JSON `CompletionResult`            |
| `POST` | `/api/ai/stream`   | Start streaming → JSON `{ stream_id }` (chunks via WebSocket) |
| `POST` | `/api/ai/embed`    | Generate embeddings → JSON `EmbeddingResult`                  |
| `POST` | `/api/ai/cancel`   | Cancel a stream → JSON `{ ok: true }`                         |

Request bodies are validated: messages must have valid roles and content, `max_tokens` is capped at 128,000, `temperature` must be 0–2, `top_p` must be 0–1.

### createAiMessageHandler()

Wires AI-specific WebSocket messages (resume, cancel) into your `WebsocketServer`:

```typescript
const ai = aiProcessing(db, { ... });
const aiMessageHandler = createAiMessageHandler(ai);

export class WebsocketDO extends WebsocketServer {
	constructor(ctx: DurableObjectState, env: Env) {
		super({
			onMessage: (msg, session, server) => {
				const result = aiMessageHandler(msg);
				if (result) return result.reply;

				// Handle other messages...
			},
		}, ctx, env);
	}
}
```

Returns `{ handled: true, reply? }` for `ai:stream:resume` and `ai:stream:cancel` events, or `null` for unrecognized events.

## Embeddings

### How it works

1. **Schema:** `defineAiTable()` adds `embedding`, `embedding_status`, `embedding_error`, `embedding_model`, and `_embedding_source` fields to your table
2. **Change detection:** After create/update, call `ai.scheduleIfChanged(entityType, id, data)`. It hashes the source text (djb2) and compares against the stored hash. If different, the record is marked `pending`
3. **Alarm processing:** The DO alarm calls `ai.processAlarm()`, which fetches up to 10 pending records, marks them `processing`, generates embeddings, and stores the vectors
4. **Retry logic:** Failed records are retried up to 5 times (configurable). In-memory retry tracking survives across alarm cycles within the same DO instance. Stuck `processing` records are automatically recovered
5. **Broadcasting:** Embedding status changes are broadcast via WebSocket (`ai:embedding:updated`)

### Embedding field config

```typescript
interface EmbeddingFieldConfig {
	/** Entity type (table name) */
	entity_type: string;

	/** Fields to concatenate for embedding text */
	source_fields: string[];

	/** Separator between fields (default: '\n') */
	separator?: string;

	/** Custom text extraction (overrides source_fields) */
	extractText?: (record: Record<string, unknown>) => string;
}
```

### Backfilling

After adding AI to an existing table, backfill all un-embedded records:

```typescript
const result = await ai.backfill('article');
console.log(`${result.processed} processed, ${result.failed} failed`);
// Records are set to 'pending' and processed via the next alarm cycle
```

## Client (Svelte 5)

### AiClient

Reactive client that receives streaming chunks over WebSocket and auto-resumes on reconnect.

```typescript
const ai = new AiClient({
	ws, // WebsocketClient instance
	api_path: '/api/ai', // API path prefix (default: '/api/ai')
});
```

### Methods

| Method              | Description                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `chat(options)`     | Start a streaming completion. Resets state and posts to `/api/ai/stream`. Chunks arrive via WebSocket. |
| `complete(options)` | Non-streaming completion. Posts to `/api/ai/complete` and updates reactive state with the full result. |
| `cancel()`          | Cancel the current stream. Posts to `/api/ai/cancel`.                                                  |
| `destroy()`         | Clean up all WebSocket listeners. Call when the component is destroyed.                                |

### Reactive state

All properties are Svelte 5 `$state` and trigger reactive updates in templates:

| Property        | Type                 | Description                                                               |
| --------------- | -------------------- | ------------------------------------------------------------------------- |
| `streaming`     | `boolean`            | Whether a completion is in progress                                       |
| `content`       | `string`             | Accumulated generated text                                                |
| `error`         | `string \| null`     | Error message if something failed                                         |
| `stream_id`     | `string \| null`     | Active stream ID                                                          |
| `usage`         | `TokenUsage \| null` | Token counts (after completion)                                           |
| `finish_reason` | `string \| null`     | Why generation stopped (`stop`, `length`, `tool_calls`, `content_filter`) |
| `tool_calls`    | `ToolCall[]`         | Tool calls from the assistant (merged from streaming deltas)              |

### Auto-resume

When the WebSocket reconnects (`ws:connected`), the client automatically sends an `ai:stream:resume` message with the current content length as `last_offset`. The server replays any missed chunks from its in-memory buffer.

## Schema

### defineAiTable()

Extends `Database.table()` with embedding fields:

```typescript
const articleTable = defineAiTable('article', (schema) => ({
	title: schema.string().searchable(),
	body: schema.string(),
}));

// Custom vector dimensions (default: 768 for bge-base-en-v1.5)
const articleTable = defineAiTable(
	'article',
	(schema) => ({
		title: schema.string().searchable(),
	}),
	{ dimensions: 1024 },
);
```

**Auto-added fields:**

| Field               | Type                                                               | Description                            |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| `id`                | `primaryKey()`                                                     | Auto-generated ID                      |
| `embedding`         | `vector(768).optional()`                                           | The embedding vector                   |
| `embedding_status`  | `enum(['pending', 'processing', 'embedded', 'failed']).optional()` | Processing status                      |
| `embedding_error`   | `string().optional()`                                              | Error message on failure               |
| `embedding_model`   | `string().optional()`                                              | Model used to generate the embedding   |
| `_embedding_source` | `string().optional()`                                              | Hash of source text (change detection) |
| `created_at`        | `number` (epoch ms, auto-managed)                                  | Creation timestamp                     |
| `updated_at`        | `number` (epoch ms, auto-managed)                                  | Last update timestamp                  |

### defineAiConversationTable()

Creates a table for persisting chat history:

```typescript
// Basic
const conversationTable = defineAiConversationTable();

// With custom fields
const conversationTable = defineAiConversationTable((schema) => ({
	user_id: schema.string(),
	title: schema.string().searchable(),
	context: schema.string().optional(),
}));
```

**Auto-added fields:**

| Field          | Type                                                                     | Description            |
| -------------- | ------------------------------------------------------------------------ | ---------------------- |
| `id`           | `primaryKey()`                                                           | Auto-generated ID      |
| `messages`     | `array(object({ role, content, tool_call_id, tool_calls, created_at }))` | Conversation messages  |
| `model`        | `string().optional()`                                                    | Model used             |
| `total_tokens` | `number().int().optional()`                                              | Cumulative token usage |
| `status`       | `enum(['active', 'archived'])`                                           | Conversation state     |
| `created_at`   | `number` (epoch ms, auto-managed)                                        | Creation timestamp     |
| `updated_at`   | `number` (epoch ms, auto-managed)                                        | Last update timestamp  |

## Types

### CompletionOptions

```typescript
interface CompletionOptions {
	messages: ConversationMessage[];
	model: string; // e.g. 'gpt-4o', '@cf/meta/llama-3-8b-instruct', 'dynamic/my-route'
	max_tokens?: number;
	temperature?: number; // 0–2 (default: 1)
	top_p?: number; // 0–1 (default: 1)
	system?: string; // Prepended as system message if not present
	tools?: ToolDefinition[]; // Function calling
	response_format?: { type: 'text' } | { type: 'json_object' };
	metadata?: Record<string, string>; // AI Gateway logging/routing metadata
	user_id?: string; // AI Gateway per-user tracking
	signal?: AbortSignal;
}
```

### ConversationMessage

```typescript
interface ConversationMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null; // null for tool-call-only assistant messages
	tool_call_id?: string;
	tool_calls?: ToolCall[];
}
```

### WebSocket message types

| Event                  | Direction       | Description                                            |
| ---------------------- | --------------- | ------------------------------------------------------ |
| `ai:stream:chunk`      | Server → Client | Streaming text delta, tool calls, usage, and done flag |
| `ai:stream:error`      | Server → Client | Stream error with error code                           |
| `ai:stream:resume`     | Client → Server | Resume stream from last_offset                         |
| `ai:stream:cancel`     | Client → Server | Cancel an active stream                                |
| `ai:embedding:updated` | Server → Client | Embedding status changed for a record                  |

### Error codes

| Code                 | HTTP Status | Description                               |
| -------------------- | ----------- | ----------------------------------------- |
| `PROVIDER_ERROR`     | 502         | Error from the upstream AI provider       |
| `GATEWAY_ERROR`      | 502         | AI Gateway configuration or routing error |
| `RATE_LIMITED`       | 429         | Provider rate limit exceeded              |
| `MODEL_NOT_FOUND`    | 404         | Model does not exist                      |
| `CONTEXT_TOO_LONG`   | 400         | Input exceeds model's context window      |
| `CONTENT_FILTERED`   | 400         | Content was filtered by safety systems    |
| `STREAM_INTERRUPTED` | 500         | Stream was interrupted unexpectedly       |
| `EMBEDDING_FAILED`   | 500         | Embedding generation failed               |
| `INTERNAL_ERROR`     | 500         | Internal server error                     |

All errors use `DelightError` from `@delightstack/utilities`.

## Design Decisions

**Why stream via WebSocket instead of SSE?** The WebSocket connection already exists for real-time features (presence, entity sync). Reusing it avoids opening a second long-lived connection per stream. It also enables server-initiated streaming — the server can start a stream in response to a database trigger or background job, not just a client request.

**Why in-memory buffers instead of durable storage?** Streaming data is ephemeral — it only matters for the few minutes a response is generating. Writing every chunk to SQLite or KV would add unnecessary latency and cost. The 5-minute TTL for completed buffers is enough time for a disconnected client to resume.

**Why alarm-based embeddings instead of inline?** Embedding generation takes 50–200ms per record. Running it synchronously in a create/update handler would block the response. The alarm pattern moves embedding work to a separate execution context, keeping CRUD operations fast. It also naturally batches work and handles retries.

**Why djb2 for change detection?** The hash only needs to detect whether source text changed between updates — it doesn't need to be cryptographic. djb2 is fast (important since it runs in afterCreate/afterUpdate hooks), produces low collision rates for text, and computes synchronously without async overhead.

**Why lazy gateway initialization?** The AI binding (`env.AI`) may not be available at Durable Object construction time in some Cloudflare runtime scenarios. Creating the gateway on first use avoids errors during initialization.

## Exports

### `@delightstack/ai` (types only)

| Export                 | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `CompletionOptions`    | Chat completion request options                       |
| `CompletionResult`     | Non-streaming completion result                       |
| `StreamChunk`          | Single chunk in a streaming response                  |
| `EmbeddingOptions`     | Embedding request options                             |
| `EmbeddingResult`      | Embedding response with vectors                       |
| `ConversationMessage`  | Single message in a conversation                      |
| `ToolCall`             | Tool call from the assistant                          |
| `ToolDefinition`       | Tool definition for function calling                  |
| `TokenUsage`           | Token usage statistics                                |
| `MessageRole`          | `'system' \| 'user' \| 'assistant' \| 'tool'`         |
| `EmbeddingStatus`      | `'pending' \| 'processing' \| 'embedded' \| 'failed'` |
| `AiErrorCode`          | Union of AI error code strings                        |
| `EmbeddingFieldConfig` | Config for which fields to embed per entity type      |
| `AiProcessingOptions`  | Options for the `aiProcessing()` factory              |
| `RESERVED_AI_FIELDS`   | Set of field names managed by the AI package          |
| `AiWebsocketMessage`   | Union of all AI-specific WebSocket messages           |

### `@delightstack/ai/server`

| Export                   | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `aiProcessing`           | Main factory — composes gateway + embeddings + streaming |
| `createAiGateway`        | Lower-level AI Gateway client factory                    |
| `aiEmbeddings`           | Standalone embedding processor factory                   |
| `createAiHandle`         | SvelteKit Handle for AI HTTP endpoints                   |
| `createAiMessageHandler` | WebSocket message handler for resume/cancel              |
| `createAiError`          | Error creation helper with AI-specific codes             |
| `AiServer`               | Type for the `aiProcessing()` return value               |
| `AiServerOptions`        | Type for `aiProcessing()` options                        |
| `AiGatewayClient`        | Type for the gateway client                              |
| `AiGatewayOptions`       | Type for `createAiGateway()` options                     |
| `AiHandleOptions`        | Type for `createAiHandle()` options                      |
| `AiMessageHandlerResult` | Type for message handler return value                    |

### `@delightstack/ai/client` (Svelte 5 only)

| Export           | Description                                       |
| ---------------- | ------------------------------------------------- |
| `AiClient`       | Reactive AI client with streaming and auto-resume |
| `AiClientConfig` | Type for `AiClient` constructor config            |

### `@delightstack/ai/schema`

| Export                      | Description                                               |
| --------------------------- | --------------------------------------------------------- |
| `defineAiTable`             | Create a table with auto-managed embedding fields         |
| `defineAiConversationTable` | Create a conversation history table                       |
| `AiTable`                   | Type for a table created by `defineAiTable()`             |
| `AiConversationTable`       | Type for a table created by `defineAiConversationTable()` |

## Project Structure

```
packages/ai/
├── index.ts                        # Root entry — re-exports types
│
├── types/
│   ├── index.ts                    # Type barrel exports
│   ├── ai.type.ts                  # Core types (CompletionOptions, EmbeddingOptions, etc.)
│   └── message.type.ts             # WebSocket message types (stream chunks, errors, resume)
│
├── server/
│   ├── index.ts                    # Server barrel exports
│   ├── ai.server.ts                # aiProcessing() factory + resumable streaming + WS handler
│   ├── ai.gateway.ts               # createAiGateway() — Workers AI + AI Gateway unified client
│   ├── ai.embeddings.ts            # aiEmbeddings() — alarm-based async embedding processor
│   ├── ai.handler.ts               # createAiHandle() — SvelteKit HTTP route handler
│   └── ai.errors.ts                # createAiError() — DelightError factory with AI error codes
│
├── client/
│   ├── index.ts                    # Client barrel exports
│   └── ai.client.svelte.ts         # AiClient — reactive Svelte 5 class with auto-resume
│
├── schema/
│   └── schema.ts                   # defineAiTable(), defineAiConversationTable()
│
├── package.json
└── tsconfig.json
```
