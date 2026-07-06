# AI × Images × Database Integration — Design Spec

## Why this exists

The stack already has three pieces that are individually strong but never talk
to each other:

- `@delightstack/images` processes uploads (Cloudflare Container + Sharp),
  stores rich metadata rows via `@delightstack/database`, and serves variants
  from R2.
- `@delightstack/ai` does chat/streaming through AI Gateway and has a complete
  alarm-driven **embedding pipeline** (`aiEmbeddings`) that writes
  `schema.vector()` columns.
- `@delightstack/database` already supports **vector and hybrid search**
  through Orama (`SearchQueryInput.vector`, hybrid = term + vector).

The missing seam is **ai ↔ images**. Today an uploaded photo is a dumb blob
with EXIF; nothing in the stack can answer "show me photos of a sunset on the
beach", write alt text for accessibility, tag images for faceted browsing, or
let a chat model look at an uploaded image. Every one of those is a small
bridge over infrastructure that already exists.

The delight moment: `images.upload(file)` and, seconds later, the record has a
caption, alt text, tags, and an embedding — and
`db.search('image', { q: 'sunset on the beach', mode: 'hybrid' })` just works
on the client through the existing reactive `DatabaseSearch`, thumbhash
placeholders and all. One upload call, a fully intelligent media library.

## Decisions (locked)

1. **No hard dependency between `ai` and `images` in either direction.** They
   integrate through a hook: `images` exposes an `enrich` extension point,
   `ai` ships a factory that produces a compatible enrich function. Apps that
   use both opt in with one line; apps that use only one pay nothing. Types
   are matched **structurally** (the ai side declares a minimal interface) so
   there is no runtime or `package.json` dependency added.
2. **Vision inference runs in the Worker/DO, never in the container.**
   `ImageProcessorContainer` has `enableInternet=false` and no `env.AI`
   binding; it stays a pure Sharp pipeline. All AI calls go through the
   existing `AiGatewayClient` from the DO where `env.AI` is available.
3. **Semantic image search is caption-based, not CLIP-based.** Workers AI has
   no image-embedding model; the pragmatic path is vision-caption → existing
   text embedding (`@cf/baai/bge-base-en-v1.5`, 768-dim). If a multimodal
   embedding model lands on Workers AI later, only `embedding_model` and the
   source-extraction change — the storage/search layer is already
   vector-model-agnostic.
4. **Enrichment is best-effort.** A failed caption/tag call must never fail
   the image: the record still flips to `processed`, enrichment fields stay
   null, and the error is recorded in a dedicated field. Image availability
   is the product; intelligence is progressive enhancement.
5. **Reuse the existing pipelines, don't build new ones.** Captioning rides
   inside `processAlarm()` in `images` (the bytes are already in hand).
   Embedding rides on the existing `aiEmbeddings` alarm loop (the `image`
   table becomes just another `EmbeddingFieldConfig` entry). No new DO, no
   new alarm chain. When `@delightstack/jobs` lands (see Jobs Package Plan),
   both loops migrate together — nothing here fights that plan.
6. Follow all repo conventions: `snake_case` fields, `camelCase` functions,
   `DelightError` for operational errors, singular API routes, pnpm.

## Phase map (each phase ships independently, in order)

| Phase | Deliverable | Packages touched |
| --- | --- | --- |
| 1 | `enrich` + `on_processed` hooks in the images pipeline | images |
| 2 | `aiImageEnrichment()` bridge: caption, alt text, tags, moderation | ai |
| 3 | Image embeddings + semantic/hybrid gallery search | ai, example-app |
| 4 | Similar-images / near-duplicate helpers | ai |
| 5 | Multimodal chat messages (image parts) | ai |
| 6 | `generateImage()` → upload pipeline loop | ai, example-app |
| 7 | OCR / text-in-image extraction (optional) | ai |

Phases 1–3 are the core and should land together as the first milestone.
Phases 4–7 are independent follow-ups in any order.

---

## Phase 1 — `enrich` hook in `@delightstack/images`

### What

Two new optional callbacks on `ImageProcessingOptions`
(`packages/images/src/types.ts`), consumed by `processAlarm()` in
`packages/images/src/integration.ts`:

```ts
export interface EnrichContext {
	/** The image record as it will be written (pre-enrichment) */
	record: ImageRecord;
	/** Full metadata returned by the container (superset of what is persisted) */
	metadata: ImageMetadata;
	/** The variants that were just written to R2 */
	variants: OutputVariant[];
	/**
	 * Read a variant's bytes back from R2. Defaults to the smallest
	 * non-original variant (usually 'thumbnail') when name is omitted.
	 * Returns null if the variant doesn't exist.
	 */
	getVariantBytes: (name?: string) => Promise<{
		data: ArrayBuffer;
		mime_type: string;
	} | null>;
}

/**
 * Returns extra fields to merge into the final 'processed' update,
 * or null for no changes. Field names must be custom (non-reserved)
 * columns the app added via defineImageTable(customFields).
 */
export type ImageEnrichFn = (ctx: EnrichContext) => Promise<Record<string, unknown> | null>;

export interface ImageProcessingOptions {
	// ...existing fields...
	/** Optional enrichment step, runs after variants are written, before the record flips to 'processed' */
	enrich?: ImageEnrichFn;
	/** Called after a record is updated to 'processed' (enrichment included). Use to schedule embeddings etc. */
	on_processed?: (record: ImageRecord) => void | Promise<void>;
}
```

### How (exact insertion points in `integration.ts` → `processAlarm()`)

The current flow per image is: mark `processing` → read original from R2 →
container RPC → write variants to R2 → deleted-during-processing check →
final `db.update(..., { processing_status: 'processed', ...fields, ... })`.

Insert enrichment between the deleted-check and the final update:

1. Build `EnrichContext`. `getVariantBytes(name)` resolves the variant from
   `outputVariants`, defaults to the smallest by `file_size` excluding
   `original`, and reads `bucket.get(variant.key)`.
2. `let enriched: Record<string, unknown> | null = null;` — call
   `options.enrich(ctx)` inside its own try/catch. On throw: log nothing
   fatal; set `enrichment_error` (see schema below) in the final update and
   continue. **Do not** increment the image retry counter and do not touch
   `processing_status` — decision 4.
3. Guard the returned object: reject keys in `RESERVED_IMAGE_FIELDS`
   (`packages/images/src/types.ts`) by throwing a `DelightError.badRequest`
   that is caught by the same enrichment try/catch (a misconfigured enrich fn
   must not brick uploads either — surfaced via `enrichment_error`).
4. Merge into the single final `db.update`:
   `{ processing_status: 'processed', ...metadataFields, ...enriched, enrichment_error, thumbhash, variants, _processing: null }`.
   One update = one DB broadcast, no extra churn.
5. After the update succeeds, `await options.on_processed?.(updatedRecord)`
   in its own try/catch (same non-fatal rule). Fetch the updated record via
   the existing `tryGet` so the callback sees the enriched row.

Also call `on_processed` from `retry()`? No — retry just re-queues; the
callback fires when processing actually completes.

### Schema addition

Add one reserved field to `defineImageTable` (`packages/images/src/schema.ts`)
and to `RESERVED_IMAGE_FIELDS`:

```ts
/** Error message from the enrich hook, null when enrichment succeeded or is not configured */
enrichment_error: schema.string().optional(),
```

### Why this shape

- Enrichment runs while the alarm loop already holds the image context — no
  second fetch of originals, no second queue.
- `getVariantBytes` (not raw original bytes) is the API because vision models
  want small inputs; the 640px `thumbnail` variant is ideal and the original
  may be 50MB.
- `on_processed` exists because direct `db.update()` calls inside
  `processAlarm()` bypass the route-layer lifecycle hooks in
  `database.handler.ts` — without this callback there is no clean place for
  the app to call `embeddings.scheduleIfChanged()` (Phase 3).

### Tests (`packages/images/src/integration.test.ts` pattern already exists)

- enrich returns fields → merged into the processed record.
- enrich throws → record still `processed`, `enrichment_error` set, variants
  intact.
- enrich returns a reserved key → rejected, surfaced via `enrichment_error`.
- `on_processed` receives the *enriched* record; its throw doesn't fail
  processing.
- No `enrich` configured → byte-identical behavior to today.

---

## Phase 2 — `aiImageEnrichment()` bridge in `@delightstack/ai`

### What

A new server factory `packages/ai/src/server/ai.enrichment.ts`, exported from
`@delightstack/ai/server`, that produces an images-compatible enrich function:

```ts
export interface AiImageEnrichmentOptions {
	ai: () => Ai;
	gateway?: string;
	/** Pre-built gateway client (share with aiProcessing, same pattern as aiEmbeddings) */
	gateway_client?: AiGatewayClient;

	/** Generate a one-paragraph caption into the `caption` field. Default model: '@cf/llava-hf/llava-1.5-7b-hf' */
	caption?: boolean | { model?: string; prompt?: string; max_tokens?: number };

	/** Fill `alt_text` ONLY when the uploader left it empty (never overwrite human input). Uses a short-form caption prompt. */
	alt_text?: boolean | { model?: string; max_tokens?: number };

	/** Classify into `ai_tags` (string array). Default model: '@cf/microsoft/resnet-50' */
	tags?: boolean | { model?: string; max_tags?: number; min_confidence?: number };

	/** Moderation verdict into `moderation` field. Vision-model prompt returning strict JSON. */
	moderation?: boolean | { model?: string };
}

export function aiImageEnrichment(options: AiImageEnrichmentOptions): ImageEnrichFn;
```

**No import from `@delightstack/images`.** Declare a local structural type for
the context (the parts the bridge needs):

```ts
interface EnrichableImage {
	record: { alt_text?: string | null; is_animated?: boolean | null; [key: string]: unknown };
	getVariantBytes: (name?: string) => Promise<{ data: ArrayBuffer; mime_type: string } | null>;
}
```

TypeScript structural typing makes the returned function assignable to
`ImageEnrichFn` at the app's wiring site — that's the decoupling seam.

### How

1. Call `getVariantBytes()` once (default/smallest variant), share the bytes
   across all enabled enrichers. If null (e.g. only `original` kept), return
   null — nothing to enrich. Skip enrichment entirely for SVG mime types and
   optionally for `is_animated` (first frame is what the variant encodes, so
   animated is actually fine — do not skip; note this in a comment).
2. **Caption** — Workers AI LLaVA call shape:
   `ai.run('@cf/llava-hf/llava-1.5-7b-hf', { image: [...new Uint8Array(data)], prompt, max_tokens })`
   → `{ description: string }`. Default prompt:
   `"Describe this image in one detailed paragraph. Mention the main subject, setting, colors, and mood. Do not start with 'The image shows'."`
   Route through `AiGatewayClient` if it grows a `runVision()` helper (see
   below), otherwise call `options.ai().run()` directly with
   `{ gateway: { id: options.gateway } }` for analytics — match how
   `ai.gateway.ts` invokes Workers AI models today.
3. **Alt text** — separate, shorter prompt
   (`"Write concise alt text for this image in one sentence, under 125 characters, for a screen reader."`).
   Only produced when `ctx.record.alt_text` is empty/null. If both `caption`
   and `alt_text` are enabled, still make two calls (different prompts
   produce meaningfully different text); cheap at thumbnail size.
4. **Tags** — `ai.run('@cf/microsoft/resnet-50', { image: [...bytes] })` →
   `[{ label, score }]`. Filter by `min_confidence` (default 0.6), take
   `max_tags` (default 5), lowercase labels, split resnet's comma-separated
   synonyms (`"tabby, tabby cat"` → take the first). Store as `string[]`.
5. **Moderation** — vision model with a strict-JSON prompt returning
   `{ nsfw: boolean, violence: boolean, reason: string | null }`. Parse
   defensively (the model may wrap in prose — extract the first `{...}`
   block); on parse failure, omit the field rather than guessing. Store as
   the `moderation` object field below. Blocking/quarantine behavior is the
   **app's** job via `on_processed` or route hooks — the bridge only records
   the verdict. Document this explicitly in the README.
6. Each enricher has its own try/catch; one failing must not lose the others'
   results. If *all* enabled enrichers fail, throw a single
   `DelightError` (`code: 'ENRICHMENT_FAILED'`) so images records it in
   `enrichment_error`. If some succeed, return the partial object.
7. Return shape: only include keys for enrichers that ran and succeeded, e.g.
   `{ caption, alt_text, ai_tags, moderation }`.

### Gateway plumbing

Add a small method to `AiGatewayClient` (`packages/ai/src/server/ai.gateway.ts`):

```ts
/** Run a Workers AI vision/classification model with raw image bytes */
runVision(model: string, input: { image: number[]; prompt?: string; max_tokens?: number }): Promise<unknown>;
```

— thin wrapper over `ai.run(model, input, { gateway })` so gateway analytics,
error normalization (`createAiError`), and future provider routing stay in
one place. `aiImageEnrichment` uses this exclusively.

### Schema helper

The enrichment fields are **custom columns the app must add** to its image
table. Export a helper from `packages/ai/src/schema/schema.ts` so apps don't
hand-roll them:

```ts
/** Field definitions for AI image enrichment. Spread into defineImageTable's customFields. */
export function aiImageFields(schema: AiSchemaBuilder) {
	return {
		/** AI-generated caption (one paragraph) */
		caption: schema.string().optional().searchable(),
		/** AI-generated classification tags */
		ai_tags: schema.array(schema.string()).optional().searchable(),
		/** AI moderation verdict */
		moderation: schema
			.object({ nsfw: schema.boolean(), violence: schema.boolean(), reason: schema.string().optional() })
			.optional(),
	};
}
```

App wiring becomes:

```ts
const imageTable = defineImageTable((schema) => ({
	...aiImageFields(schema),
	...aiEmbeddingFields(schema), // Phase 3
	user_id: schema.string(),
}));
```

None of these collide with `RESERVED_IMAGE_FIELDS` (verified against
`packages/images/src/schema.ts`). `alt_text` already exists on the base image
table — the bridge writes to it, it is NOT redefined here.

### Tests (`packages/ai/src/server/ai.enrichment.test.ts`)

Mock `Ai` binding (`{ run: vi.fn() }`), fake `getVariantBytes`:

- caption + tags + alt_text enabled → correct models called with byte arrays,
  merged result shape.
- `alt_text` skipped when record already has alt_text.
- resnet label filtering: confidence threshold, max_tags, synonym splitting.
- moderation JSON extraction from prose-wrapped output; parse failure omits
  the key.
- one enricher throws → others still returned; all throw →
  `DelightError` with `ENRICHMENT_FAILED`.
- `getVariantBytes` returns null → enrich returns null, zero AI calls.

---

## Phase 3 — Image embeddings + semantic gallery search

### What

Make the `image` table a first-class citizen of the existing `aiEmbeddings`
pipeline, then expose semantic/hybrid search end to end.

### 3a. Embedding schema helper

Extract the reserved-field block of `defineAiTable`
(`packages/ai/src/schema/schema.ts`) into a reusable, exported helper so any
existing table (image included) can adopt embeddings:

```ts
/** The reserved AI embedding fields. Spread into any table's custom fields. */
export function aiEmbeddingFields(schema: AiSchemaBuilder, opts?: { dimensions?: number }) {
	return {
		embedding: schema.vector(opts?.dimensions ?? 768).optional(),
		embedding_status: schema.enum(['pending', 'processing', 'embedded', 'failed']).optional(),
		embedding_error: schema.string().optional(),
		embedding_model: schema.string().optional(),
		_embedding_source: schema.string().optional(),
	};
}
```

Refactor `defineAiTable` to use it internally (behavior unchanged — keep its
existing tests green). Match the exact field definitions currently inside
`defineAiTable`; the list above is indicative, the source of truth is that
function.

### 3b. Wiring recipe (this is documentation + example-app code, not package code)

In the app's Durable Object:

```ts
const embeddings = aiEmbeddings(db, {
	ai: () => env.AI,
	storage: this.ctx.storage,
	ws: () => this.ws,
	fields: [
		{
			entity_type: 'image',
			source_fields: ['caption', 'alt_text', 'file_name', 'ai_tags'],
		},
	],
});

const images = imageProcessing(db, {
	container: () => env.IMAGE_PROCESSOR,
	bucket: () => env.MEDIA_BUCKET,
	storage: this.ctx.storage,
	enrich: aiImageEnrichment({ ai: () => env.AI, caption: true, alt_text: true, tags: true }),
	on_processed: (record) => embeddings.scheduleIfChanged('image', record.id, record),
});

async alarm() {
	await images.processAlarm();
	await embeddings.processAlarm();
}
```

Notes for the implementer:

- **Both pipelines share one DO alarm** — this already works because both
  `scheduleAlarm` implementations are "set only if not already imminent" and
  both `processAlarm`s are no-ops when they have no pending rows. Call both
  from `alarm()`, order: images first (it produces the text embeddings
  consume). Verify there is no pathological re-scheduling loop in a test.
- `_embedding_source` hashing (djb2 in `ai.embeddings.ts`) gives idempotency:
  re-processing an image with an unchanged caption does not re-embed.
- When a **human edits** `alt_text`/`caption` through the CRUD routes, the
  app's route-level `AfterWrite` hook (`database.handler.ts`) must also call
  `embeddings.scheduleIfChanged('image', ...)`. Add this to the recipe.

### 3c. Semantic search route

The client cannot produce query vectors, so hybrid search needs one server
hop that embeds the query text. Add a helper to
`packages/ai/src/server/ai.server.ts` (method on the object returned by
`aiProcessing`):

```ts
/**
 * Embed `q` and run a hybrid (term + vector) search on the given entity.
 * Falls back to plain full-text search if embedding fails.
 */
async searchSemantic(entity_type: string, query: SearchQueryInput & { q: string }): Promise<SearchResult> {
	try {
		const { vectors } = await this.embed({ input: query.q });
		return db.search(entity_type, { ...query, vector: { value: vectors[0], property: 'embedding' }, mode: 'hybrid' });
	} catch {
		return db.search(entity_type, query); // graceful degradation
	}
}
```

(Exact `SearchQueryInput` field names — `mode`, `vector.property` — must be
taken from `packages/database/src/search-query.ts` at implementation time.)

Expose it over HTTP by extending `createAiHandle`
(`packages/ai/src/server/ai.handler.ts`) with
`POST /api/ai/search { entity_type, query }`, gated by the existing
`authorize` hook. Singular route names per convention.

### 3d. Example-app demo (the proof)

A gallery page in `apps/example-app`:

- Upload zone → `images.upload()`; grid renders via `toImageProps()` +
  thumbhash placeholders; `ai:embedding:updated` WS messages flip a small
  "✨ indexed" badge per card.
- One search box hitting `/api/ai/search` for `image`, hybrid mode, results
  re-rendered through the same grid. Search "sunset on the beach" against a
  seeded set of photos — this is the demo that sells the stack.
- Heads-up from repo memory: the AI binding forces wrangler remote mode in
  local dev (see `example-app-local-dev-wrangler` gotcha) — verify UI with a
  mock `/api/ai/search` route locally, real binding in preview deploys.

### Tests

- `aiEmbeddingFields` output matches `defineAiTable`'s reserved fields
  exactly (snapshot both).
- End-to-end DO test (edge-runtime, mocked Ai + container): upload → alarm →
  enriched + `processed` → second alarm cycle embeds → hybrid `searchSemantic`
  returns the image for a caption keyword. This one test exercises the whole
  Phase 1–3 spine.
- `searchSemantic` fallback when `embed` rejects.

---

## Phase 4 — Similar images & near-duplicate detection

Small helpers, no new infrastructure — pure vector-search recipes formalized:

```ts
// on the aiProcessing() return object
/** Find images semantically similar to a given image (excludes itself). */
async similar(entity_type: string, id: string, opts?: { limit?: number }): Promise<SearchResult>;
```

Implementation: `db.get(entity_type, id)` → read its `embedding` → pure
vector-mode `db.search` with `limit + 1` → filter out `id`. Throw
`DelightError.badRequest` when the record has no embedding yet
(`embedding_status !== 'embedded'`).

**Near-duplicate on upload** stays a documented recipe (not package code):
in `on_processed`, after embedding completes (listen for the
`ai:embedding:updated` broadcast or check in a later pass), run `similar()`
and flag pairs above a cosine-similarity threshold (~0.95) into an app-level
field. Cheap coarse pre-filter available for free: compare `thumbhash`
strings first. Do not build automatic dedup/blocking into the packages — too
product-specific.

Add a "More like this" rail to the example-app gallery detail view.

---

## Phase 5 — Multimodal chat (images as message content)

### What

Let `complete()`/`stream()` accept image parts, so apps (and the editor's
planned `aiExtension`, see Editor Package Plan phase 2E) can do "chat about
this image".

### Type change (`packages/ai/src/types/ai.type.ts`)

```ts
export type MessageContentPart =
	| { type: 'text'; text: string }
	| { type: 'image'; image_id: string; variant?: string }  // resolved server-side
	| { type: 'image_url'; url: string };                     // pass-through (data: or https:)

export interface ConversationMessage {
	role: MessageRole;
	content: string | MessageContentPart[] | null;  // string stays valid — zero breakage
	tool_call_id?: string;
	tool_calls?: ToolCall[];
}
```

### Resolution seam (keeps decoupling)

`AiServerOptions` gains an optional generic resolver — NOT an images
dependency:

```ts
/** Resolve an image_id content part to raw bytes. Wire to the images package (or anything else). */
resolve_image?: (image_id: string, variant?: string) => Promise<{ data: ArrayBuffer; mime_type: string } | null>;
```

App wiring: read the image record, pick the requested variant (default
`thumbnail` — models don't need 2048px), `bucket.get(variant.key)`. Provide
this exact snippet in the README. When a part has `image_id` and no resolver
is configured, or the resolver returns null → `DelightError.badRequest`
(`code: 'MODEL_NOT_FOUND'` is wrong — add `IMAGE_UNRESOLVED` to
`AiErrorCode`).

### Provider mapping (`ai.gateway.ts`)

- **Compat/OpenAI-shape** (`chat/completions` through the gateway): map parts
  to OpenAI content arrays — text parts as `{type:'text'}`, resolved images
  as `{type:'image_url', image_url:{url:'data:<mime>;base64,<...>'}}`.
  Anthropic/OpenAI/Gemini all accept this via the gateway's unified endpoint.
- **Workers AI** (`@cf/` vision models like llava): these take a single
  `image: number[]` + `prompt` — collapse the message list: last image part
  wins as `image`, concatenated text becomes `prompt`. Throw
  `DelightError.badRequest` when a `@cf/` model gets multiple images.
- Text-only models receiving image parts: strip images and log nothing?
  No — fail loudly (`badRequest`) so developers notice; a `validateModel`
  hook already exists in the handler for apps that want allowlists.

Streaming path: content parts only affect the *request* body; the SSE
parsing/resume path is untouched.

### Client (`ai.client.svelte.ts`)

`AiClient.chat()` message type widens automatically with the shared type.
Add a convenience: accept `{ image_id }` shorthand and wrap into a parts
array. The editor integration then becomes: image block selected →
`chat([{ role:'user', content:[{type:'image', image_id}, {type:'text', text: userPrompt}] }])`.

### Tests

- Round-trip mapping tests per provider shape (compat content array,
  workers-ai collapse, multi-image rejection on `@cf/`).
- Unresolved image → `IMAGE_UNRESOLVED` DelightError.
- Backward compat: plain-string content requests are byte-identical to
  today's request bodies (snapshot test).

---

## Phase 6 — `generateImage()`: AI output enters the images pipeline

### What

Close the loop: generated images become real, varianted, captioned, embedded,
CDN-served image records.

```ts
// packages/ai — types + gateway + server method
export interface ImageGenerationOptions {
	prompt: string;
	/** Default: '@cf/black-forest-labs/flux-1-schnell' */
	model?: string;
	width?: number;
	height?: number;
	steps?: number;
	seed?: number;
}
export interface ImageGenerationResult {
	data: Uint8Array;
	mime_type: string; // 'image/png' | 'image/jpeg' depending on model
	model: string;
}

// on aiProcessing():
async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult>;
```

Implementation in `ai.gateway.ts`: Workers AI image models return either raw
bytes (ReadableStream) or `{ image: base64 }` depending on model — normalize
both (check the model's actual response shape at implementation time via the
Workers AI docs; flux-1-schnell returns `{ image: base64 }`). Route through
the gateway for analytics like every other call. Errors → `createAiError`.

**The ai package does not upload.** The loop is app code (one line), which
keeps the no-dependency rule:

```ts
const generated = await ai.generateImage({ prompt });
const record = await images.upload(generated.data, {
	file_name: 'generated.png',
	data: { caption: prompt }, // seed the caption — enrichment hash will keep it unless re-captioned
});
```

Recipe note for implementers: when the app seeds `caption` at upload,
configure `aiImageEnrichment` with `caption: false` for that upload path or
accept that the vision caption will overwrite the prompt — document the
trade-off; recommend keeping the prompt in a separate custom field
(`generation_prompt: schema.string().optional().searchable()`) and letting
the normal caption run, so search hits both.

Add `POST /api/ai/image` to `createAiHandle` (authorize-gated, this one
matters — image generation is the expensive call). Example-app: a "Generate"
tab in the gallery demo.

---

## Phase 7 (optional) — OCR / text extraction

Add an `ocr` option to `aiImageEnrichment`:

```ts
/** Extract visible text into `extracted_text`. Vision-model based. */
ocr?: boolean | { model?: string; max_tokens?: number };
```

Prompt-based via llava ("Transcribe all text visible in this image verbatim.
Return only the text, or an empty string if there is none."). Quality is
model-dependent — document as best-effort; a dedicated OCR model can replace
it later behind the same option. Field via `aiImageFields`:
`extracted_text: schema.string().optional().searchable()`. Add
`extracted_text` to the embedding `source_fields` recipe. This makes
screenshots and scanned docs findable — for PDFs, the container already
rasterizes; the same enrichment applies to the rendered page image.

---

## Cross-cutting concerns

### Cost & batching

Enrichment adds 1–3 model calls per image inside `processAlarm()`'s batch of
10. Workers AI vision calls on a 640px thumbnail are fast (~1–3s) but 10×3
calls could approach DO alarm CPU/time comfort zones. Mitigation, in order:
(a) it's fine at batch 10 — measure first; (b) if needed, drop the images
batch size to 5 when `enrich` is configured; (c) the real fix is the jobs
package migration. Never parallelize model calls across the whole batch
blindly — `Promise.all` per-image's own 2–3 calls is fine, across 10 images
is a rate-limit magnet.

### Idempotency & retries

If enrichment succeeded but the final `db.update` throws, the image retries
and enrichment re-runs — acceptable (calls are cheap, results deterministic
enough). The embedding layer is already idempotent via `_embedding_source`
hashing. No new retry machinery anywhere.

### Model availability

All default models are Workers AI (`@cf/...`) so the whole feature works with
zero external API keys — pure `env.AI` binding. Every model is overridable
per-option for gateway users who want GPT-4o-class captioning. Verify current
model IDs against Workers AI's catalog at implementation time (llava/resnet
were current as of mid-2026; the code should treat model IDs as config, never
hardcode beyond defaults).

### What we are explicitly NOT building

- No CLIP/multimodal embedding pretense — caption-based, stated honestly in
  docs (decision 3).
- No automatic moderation *enforcement* (blocking/deletion) — verdict only.
- No new DO, queue, or alarm chain — jobs package owns that future.
- No `images` → `ai` or `ai` → `images` package dependency, ever. If a shared
  type becomes truly necessary, it goes in `@delightstack/utilities`.

### Documentation checklist (per phase)

- `packages/images/README.md`: enrich/on_processed section with the full
  Phase 3b wiring recipe.
- `packages/ai/README.md`: enrichment factory, `searchSemantic`, multimodal
  messages, `generateImage`.
- `apps/docs`: one "Intelligent media library" guide walking upload →
  caption → search, mirroring the example-app demo.
- `packages/components` SKILL.md: update if any new component props emerge
  from the gallery demo (per agent-docs pipeline).

### Suggested implementation order within milestone 1 (Phases 1–3)

1. Phase 1 hooks + tests (images only — mergeable alone, zero behavior change
   when unconfigured).
2. `aiEmbeddingFields` extraction + `defineAiTable` refactor (ai only,
   behavior-neutral, mergeable alone).
3. `runVision` on the gateway + `aiImageEnrichment` + tests.
4. `searchSemantic` + `/api/ai/search` handler route.
5. Example-app gallery demo + the end-to-end DO test.
6. Docs pass.
