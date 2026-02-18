# @delightstack/image-processor

A reusable Cloudflare Container-based image processing package that handles resizing, format conversion, metadata extraction, and thumbnail generation. Deploy with wrangler, use via a Workers binding.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [How It Works](#how-it-works)
- [User-Facing API](#user-facing-api)
- [Processing Pipeline](#processing-pipeline)
- [Output Variants](#output-variants)
- [Metadata Extraction](#metadata-extraction)
- [Input Validation & Limits](#input-validation--limits)
- [Supported Formats](#supported-formats)
- [Configuration](#configuration)
- [Container Internals](#container-internals)
- [Cloudflare Integration](#cloudflare-integration)
- [Delightstack Integration](#delightstack-integration)
- [Error Handling](#error-handling)
- [Cost & Performance Characteristics](#cost--performance-characteristics)
- [Technology Choices](#technology-choices)
- [Open Questions](#open-questions)
- [Future Features](#future-features)

---

## Architecture Overview

The package supports two usage modes:

### Mode 1: With `@delightstack/database` (recommended)

The database DO orchestrates everything. Upload returns immediately; processing is async.

```
User Upload
  │
  ▼
Worker ── db.images.upload(file) ── return 201
                        │
                        ▼
                  Database DO
                        │── write original to R2
                        │── create pending record
                        │── schedule alarm
                        │
                        ▼ (async, via DO alarm)
                  Database DO
                        │── read from R2
                        │── stream to Container DO
                        │          │
                        │          ▼
                        │   Docker Container (Bun + Sharp)
                        │     process / resize / extract
                        │          │
                        │   ◄── multipart response
                        │── write variants to R2
                        │── update image record (status: 'processed')
                        ▼
                  Done. Image record has all metadata.
```

The database DO owns the entire image lifecycle: it saves the original file to R2, creates the pending record, triggers processing via an alarm, writes results to R2, and updates the record. If the image record is deleted while processing is in flight, the DO cleans up any newly-created variant files.

### Mode 2: Standalone (without `@delightstack/database`)

Direct synchronous call. You manage your own storage and state.

```
Worker ── processImage(env.IMAGE_PROCESSOR, { bucket, key }) ── waits 2-30s ── result
```

### What the package exports

1. **`ImageProcessorContainer`** -- The Container/Durable Object class. Must be exported from your worker entrypoint for Cloudflare to discover it.
2. **`processImage()`** -- Standalone helper for synchronous processing (Mode 2).
3. **`imageProcessing()`** -- Factory that creates a helper object with `upload()`, `delete()`, etc. for use inside a DatabaseServer subclass (Mode 1).
4. **`defineImageTable()`** -- Database schema helper for `@delightstack/database`.

The container sleeps when idle (scale-to-zero). Cold starts take ~2-3 seconds. In Mode 2, the `processImage()` call awaits the result synchronously via RPC -- Workers have no wall-clock time limit, so waiting 2-30 seconds is fine. In Mode 1, the worker returns immediately and processing happens asynchronously inside the database DO.

---

## How It Works

### Setup with `@delightstack/database` (recommended)

**1. Install:**

```bash
pnpm add @delightstack/image-processor
```

**2. Add to wrangler.toml:**

```toml
[[containers]]
class_name = "ImageProcessorContainer"
image = "node_modules/@delightstack/image-processor/docker"
max_instances = 5
instance_type = "standard-1"  # 0.5 vCPU, 4 GiB RAM, 8 GB disk

[[durable_objects.bindings]]
name = "IMAGE_PROCESSOR"
class_name = "ImageProcessorContainer"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ImageProcessorContainer"]

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "my-media"
```

**3. Add image processing to your database DO:**

```typescript
// src/database.ts
import { DatabaseServer } from '@delightstack/database';
import {
	ImageProcessorContainer,
	imageProcessing,
	defineImageTable,
} from '@delightstack/image-processor';

// Re-export for Cloudflare to discover
export { ImageProcessorContainer };

const dbConfig = {
	image: defineImageTable(),
	// ... your other tables
};

export class AppDatabase extends DatabaseServer<typeof dbConfig> {
	// Add image processing helper — wired to this DB, the container, and the bucket
	readonly images = imageProcessing(this, {
		container: () => this.env.IMAGE_PROCESSOR,
		bucket: () => this.env.MEDIA_BUCKET,
	});

	constructor(ctx: DurableObjectState, env: Env) {
		super(dbConfig, () => null, ctx, env);
	}

	// Required: wire the alarm to the image processing helper
	async alarm() {
		await this.images.processAlarm();
	}
}
```

**4. Use it in your worker:**

```typescript
// src/index.ts
export default {
	async fetch(request: Request, env: Env) {
		const formData = await request.formData();
		const file = formData.get('file') as File;

		// upload() saves the original to R2 and creates a pending record.
		// Processing happens asynchronously in the background via DO alarm.
		// File name is extracted automatically from the File object.
		const db = env.APP_DATABASE.getByName('main');
		const image = await db.images.upload(file);

		return new Response(null, {
			status: 201,
			headers: { Location: `/images/${image.id}` },
		});
	},
};
```

That's it. One call. The user uploads a file and gets a 201 back. The `upload()` method generates a unique ID, saves the original to R2 at `/{prefix}/{id}/original`, creates the pending record, and schedules an alarm for processing. The image record transitions from `'pending'` → `'processing'` → `'processed'` (or `'failed'`). The frontend can show the thumbhash/tiny preview as soon as the record is marked `'processed'`.

### Standalone Setup (without `@delightstack/database`)

For users who manage their own state, the synchronous `processImage()` function is still available:

```typescript
import { ImageProcessorContainer, processImage } from '@delightstack/image-processor';

export { ImageProcessorContainer };

export default {
	async fetch(request: Request, env: Env) {
		// Synchronous — waits for container to finish (2-30s)
		const result = await processImage(env.IMAGE_PROCESSOR, {
			bucket: env.MEDIA_BUCKET,
			key: 'uploads/photo.jpg',
		});

		return Response.json(result);
	},
};
```

### How Async Processing Works (Mode 1: Database Integration)

When you call `db.images.upload(file)`, here's what happens:

```typescript
// Inside the imageProcessing() helper
async upload(
	data: File | ReadableStream | ArrayBuffer,
	options?: UploadOptions,
): Promise<ImageRecord> {
	// 1. Generate a unique ID for the image (used for record + R2 keys)
	const id = generateTimestampID();
	const prefix = options?.prefix ?? 'images';
	const base_path = `${prefix}/${id}`;

	// If data is a File, extract file_name automatically (options.file_name overrides)
	const file_name = options?.file_name ?? (data instanceof File ? data.name : null);
	const stream = data instanceof File ? data.stream() : data;

	// 2. Save the original file to R2
	await this.options.bucket().put(`${base_path}/original`, stream, {
		httpMetadata: {
			// Use File.type if available (best guess until processing detects the real MIME type)
			contentType: data instanceof File ? data.type : undefined,
		},
		customMetadata: file_name ? { 'original-filename': file_name } : undefined,
	});

	// 3. Create the image record with status: 'pending'
	const record = this.db.create('image', {
		id,
		base_path,
		processing_status: 'pending',
		file_name,
		// ... minimal fields, rest filled in after processing
	});

	// 3. Ensure an alarm is scheduled so processAlarm() runs.
	//    Uses "set only if earlier" to avoid overwriting a closer alarm
	//    that may have been set by other code.
	const existing = await this.db.ctx.storage.getAlarm();
	if (existing === null || Date.now() < existing) {
		await this.db.ctx.storage.setAlarm(Date.now());
	}

	// 4. Return the record immediately — the caller doesn't wait for processing
	return record;
}
```

The user's `alarm()` method delegates to `processAlarm()`:

```typescript
// In the user's DatabaseServer subclass
class AppDatabase extends DatabaseServer<typeof dbConfig> {
	readonly images = imageProcessing(this, { /* ... */ });

	async alarm() {
		// Delegate image processing work to the helper.
		// This processes pending images and reschedules if more remain.
		await this.images.processAlarm();

		// You can add your own alarm-based work here too.
		// For example: await this.cleanupExpiredSessions();
	}
}
```

Inside `processAlarm()`:

```typescript
// Inside the imageProcessing() helper
async processAlarm(): Promise<void> {
	// Find all pending images
	const pending = this.db.exec(
		`SELECT * FROM image WHERE processing_status = 'pending' LIMIT 10`
	);

	// Nothing to do — exit early, don't reschedule
	if (pending.length === 0) return;

	for (const image of pending) {
		// Mark as processing
		this.db.update('image', image.id, { processing_status: 'processing' });

		try {
			// Call the Container DO via RPC
			const containerStub = this.options.container().getByName('processor');

			// Read input from R2 and send to container
			const input = await this.options.bucket().get(`${image.base_path}/original`);
			if (!input) {
				this.db.update('image', image.id, {
					processing_status: 'failed',
					error_code: 'FILE_NOT_FOUND',
				});
				continue;
			}

			const result = await containerStub.process(await input.arrayBuffer());

			// Check if image was deleted while processing
			try {
				this.db.get('image', image.id);
			} catch {
				// Image was deleted — clean up the newly created variants
				for (const variant of result.variants) {
					await this.options.bucket().delete(variant.key);
				}
				continue;
			}

			// Write variants to R2 (extensionless keys: {base_path}/{variant_name})
			for (const variant of result.variants) {
				await this.options.bucket().put(
					`${image.base_path}/${variant.name}`,
					variant.data,
					{
						httpMetadata: {
							contentType: variant.mime_type,
							cacheControl: 'public, max-age=31536000, immutable',
						},
						customMetadata: {
							width: String(variant.width),
							height: String(variant.height),
						},
					},
				);
			}

			// Update the image record with all metadata
			this.db.update('image', image.id, {
				processing_status: 'processed',
				...result.metadata,
				thumbhash: result.thumbhash,
				tiny_preview: result.tiny_preview,
				variants: result.variant_info, // without binary data
			});
		} catch (error) {
			this.db.update('image', image.id, {
				processing_status: 'failed',
				error_code: error.code || 'INTERNAL_ERROR',
			});
		}
	}

	// If there are more pending images, schedule another alarm.
	// Uses "set only if earlier" — won't push a closer alarm further out.
	const remaining = this.db.exec(
		`SELECT count(*) as count FROM image WHERE processing_status = 'pending'`
	);
	if (remaining[0]?.count > 0) {
		const existing = await this.db.ctx.storage.getAlarm();
		if (existing === null || Date.now() < existing) {
			await this.db.ctx.storage.setAlarm(Date.now());
		}
	}
}
```

**Why alarms?** Alarms are the canonical way to do background work in Durable Objects. They're durable -- if the DO instance is evicted and re-created, the alarm still fires. This means:
- If a deploy happens mid-processing, pending images will be retried
- If the DO crashes, it recovers and picks up where it left off
- No images are lost in the queue

**Deletion during processing:** When a user deletes an image, the record is removed from the database. When the container finishes processing, the alarm handler checks whether the record still exists. If it was deleted, it cleans up any variant files that were just created in R2. No orphaned files.

### How Synchronous Processing Works (Mode 2: Standalone)

The `processImage()` helper calls the Container DO via RPC and waits for the result:

```typescript
async function processImage(
	binding: DurableObjectNamespace<ImageProcessorContainer>,
	options: ProcessImageOptions,
): Promise<ProcessImageResult> {
	const stub = binding.getByName('image-processor');

	// Direct RPC call — waits for container to finish (2-30s)
	// Workers have NO wall-clock time limit.
	// The await is I/O wait, NOT CPU time.
	return await stub.process(options);
}
```

### The Container DO (Both Modes)

The Container DO is a thin wrapper. It receives image bytes, delegates to the Docker container, and returns the results. It has no opinion about databases or state management.

```typescript
import { Container } from '@cloudflare/containers';

class ImageProcessorContainer extends Container {
	defaultPort = 8080;
	sleepAfter = '5m';
	enableInternet = false;

	// Public method = automatically exposed as RPC endpoint
	async process(
		imageData: ArrayBuffer,
		options?: VariantConfig[],
	): Promise<ContainerProcessResult> {
		// Stream input to the Docker container
		const port = this.ctx.container.getTcpPort(8080);
		const response = await port.fetch('http://localhost/process', {
			method: 'POST',
			body: imageData,
			headers: { 'X-Options': JSON.stringify(options || []) },
		});

		// Return metadata + variant binaries
		// The CALLER (database DO or standalone helper) handles R2 writes
		return parseMultipartResponse(response);
	}
}
```

Key RPC details:
- **Structured Clone serialization**: RPC uses Structured Clone (not JSON), so `ArrayBuffer` works natively for passing image data. Max payload is 32 MiB; for larger files, `ReadableStream` is used.
- **Type safety**: `DurableObjectNamespace<ImageProcessorContainer>` gives full TypeScript autocomplete on the stub.
- **Container is stateless**: It processes bytes and returns bytes. All state management and R2 I/O lives in the caller.

### R2 Access Pattern

The Docker container has no access to R2 bindings (containers are VMs, not Workers). The **caller** handles all R2 I/O:

- **Mode 1 (database integration):** The database DO reads from R2, sends bytes to the container DO via RPC, and writes variants back to R2.
- **Mode 2 (standalone):** The `processImage()` helper reads from R2, sends bytes to the container DO via RPC, and writes variants back to R2.

In both cases, `enableInternet = false` on the container (more secure), the container is fully stateless, and all storage logic lives where the R2 binding is accessible via `this.env`.

```
Mode 1 (async):

Worker                 Database DO                 Container DO
  │                       │                              │
  │── db.images.upload(file)                              │
  │                       │── write original to R2       │
  │                       │── create pending record      │
  │◄── 201 + image ID ──  │                              │
  │                       │  (alarm fires)               │
  │                       │── read from R2               │
  │                       │── RPC: process(bytes) ──►    │
  │                       │                              │── process
  │                       │                              │── resize
  │                       │                              │── extract metadata
  │                       │  ◄── variant bytes + meta ── │
  │                       │── write variants to R2       │
  │                       │── update image record        │
  │                       │                              │

Mode 2 (sync):

Worker                                              Container DO
  │                                                      │
  │── processImage(binding, { bucket, key })             │
  │   (reads from R2, sends bytes via RPC)               │
  │──────────── RPC: process(bytes) ──────────────►      │
  │                                                      │── process
  │  ◄───────── variant bytes + meta ──────────────      │
  │   (writes variants to R2)                            │
  │◄── result                                            │
```

---

## User-Facing API

### `processImage(binding, options)`

```typescript
interface ProcessImageOptions {
	/** The R2 bucket binding to use for input/output */
	bucket: R2Bucket;

	/** The key/path of the input file in the bucket */
	key: string;

	/** Whether to keep the original file after processing. Default: true */
	keep_original?: boolean;

	/**
	 * Custom variant configuration. If omitted, uses these defaults:
	 * - { name: 'default', max_dimension: 2048, format: 'avif', quality: 50, effort: 4 }
	 * - { name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4 }
	 *
	 * The tiny base64 preview and thumbhash are always generated regardless of variants.
	 */
	variants?: VariantConfig[];
}

interface VariantConfig {
	/** Unique name for this variant (used in output key and result lookup) */
	name: string;

	/** Maximum long-edge dimension in pixels. Image is fit inside this box. */
	max_dimension: number;

	/** Output format. For animated inputs, 'avif' automatically falls back to 'webp'. */
	format: 'avif' | 'webp' | 'jpeg' | 'png';

	/** Quality (1-100). Default: 50 for AVIF, 75 for WebP, 80 for JPEG, lossless for PNG */
	quality?: number;

	/** Encoding effort (0-9, higher = slower + better compression). Only applies to AVIF. Default: 4 */
	effort?: number;
}

/** Options for db.images.upload() (Mode 1: database integration) */
interface UploadOptions {
	/**
	 * R2 path prefix for all files related to this image.
	 * Default: 'images'. Files are stored at {prefix}/{id}/{variant_name}.
	 */
	prefix?: string;

	/**
	 * Original filename (e.g. "vacation-photo.jpg").
	 * Stored as metadata in the image record and as R2 custom metadata
	 * (x-amz-meta-original-filename). NOT used in R2 keys.
	 * If data is a File, this is extracted automatically from file.name.
	 * Provide explicitly to override.
	 */
	file_name?: string;

	/** Whether to keep the original file after processing. Default: true */
	keep_original?: boolean;

	/** Custom variant configuration. If omitted, uses the default variants. */
	variants?: VariantConfig[];
}
```

### `ProcessImageResult`

```typescript
interface ProcessImageResult {
	/** Whether processing succeeded */
	ok: true;

	/** Unique processing job ID */
	job_id: string;

	/** Metadata extracted from the original image */
	metadata: ImageMetadata;

	/** ThumbHash as a base64 string (~33 chars, encodes aspect ratio + transparency) */
	thumbhash: string;

	/** Tiny base64-encoded preview image as a data URI (e.g. "data:image/avif;base64,...") */
	tiny_preview: string;

	/**
	 * The generated output variants.
	 * If keep_original is true (default), the original file is included as a variant
	 * with name: 'original'. If keep_original is false, the original variant is absent.
	 */
	variants: OutputVariant[];
}

interface ImageMetadata {
	/** Original filename if provided at upload (e.g. "vacation-photo.jpg"), or null */
	file_name: string | null;

	/** File extension from file_name (lowercase, without dot), or null */
	file_extension: string | null;

	/** Detected MIME type from file magic bytes (not from extension) */
	mime_type: string;

	/** File size in bytes */
	file_size: number;

	/** Original width in pixels (after orientation correction) */
	width: number;

	/** Original height in pixels (after orientation correction) */
	height: number;

	/** Aspect ratio as width/height (e.g. 1.778 for 16:9) */
	aspect_ratio: number;

	/** Whether the image has an alpha channel and that alpha channel has data (isn't just all fully opaque) */
	has_transparency: boolean;

	/** Whether the image is animated (GIF, APNG, animated WebP) */
	is_animated: boolean;

	/** Number of animation frames (1 for static images) */
	frame_count: number;

	/** Color space (srgb, display-p3, adobe-rgb, cmyk, etc.) */
	color_space: string;

	/** Bits per channel */
	bit_depth: number;

	/** Number of channels (3 for RGB, 4 for RGBA, etc.) */
	channels: number;

	/**
	 * Background color in OKLCH format { l: 0-1, c: 0-0.4, h: 0-360 }.
	 * The average color of the image -- suitable as a background behind or replacing the image.
	 * Computed by resizing to 1x1 pixel, giving the true perceptual average of all pixels.
	 */
	background_color: { l: number; c: number; h: number };

	/** Background color as a CSS oklch() string (e.g. "oklch(0.65 0.04 210)") */
	background_color_css: string;

	/**
	 * Accent color in OKLCH format { l: 0-1, c: 0-0.4, h: 0-360 }.
	 * The most visually prominent/saturated color that stands out in the image.
	 * For example, in a mostly gray photo of a person wearing a bright red hat,
	 * this would be the red of the hat.
	 * Computed via perceptual palette extraction (node-vibrant's Vibrant swatch).
	 * May be null for achromatic images (black-and-white, grayscale).
	 */
	accent_color: { l: number; c: number; h: number } | null;

	/** Accent color as a CSS oklch() string, or null for achromatic images */
	accent_color_css: string | null;

	/** EXIF orientation value (1-8) before correction. 1 = no rotation needed */
	exif_orientation: number;

	/** Whether the image has an embedded ICC profile */
	has_icc_profile: boolean;

	/** DPI/PPI if available */
	density?: number;

	/** Format-specific info (e.g. GIF loop count, PNG interlace, JPEG progressive) */
	format_info?: Record<string, unknown>;
}

interface OutputVariant {
	/** Variant name (e.g. 'default', 'thumbnail', 'original') */
	name: string;

	/** R2 key where the variant was saved (extensionless, e.g. 'images/{id}/default') */
	key: string;

	/** MIME type of the variant (e.g. 'image/avif', 'image/jpeg') */
	mime_type: string;

	/** Width in pixels */
	width: number;

	/** Height in pixels */
	height: number;

	/** File size in bytes */
	file_size: number;

	/** Whether this variant is animated */
	is_animated: boolean;
}
```

---

## Processing Pipeline

### Static Images (JPEG, PNG, WebP, HEIC, TIFF, BMP, RAW, etc.)

```
Input
  │
  ├── 1. MIME type detection (file-type, magic bytes)
  ├── 2. Input validation (size, dimensions, format)
  ├── 3. Load with Sharp (auto-rotate from EXIF)
  ├── 4. Extract metadata (dimensions, color, alpha, ICC, etc.)
  ├── 5. Extract colors → background (1x1 average) + accent (node-vibrant) → OKLCH
  │
  ├── 6. Generate variants:
  │   ├── "default" → 2048px long-edge, AVIF q50 effort 4, strip metadata
  │   ├── "thumbnail" → 640px long-edge, AVIF q50 effort 4, strip metadata
  │   ├── "tiny" → 36px long-edge, smallest of AVIF/WebP/JPEG, base64-encode
  │   └── (any custom variants from config)
  │
  ├── 7. Generate ThumbHash from resized preview
  │
  ├── 8. Original: keep or delete per config
  │
  └── 9. Return result
```

### Animated Images (GIF, animated WebP, APNG)

```
Input
  │
  ├── 1-5. Same as static (metadata from first frame)
  │
  ├── 6. Generate variants:
  │   ├── "default" → 2048px, animated WebP (AVIF doesn't support animation)
  │   ├── "thumbnail" → 640px, animated WebP
  │   ├── "tiny" → 36px from FIRST FRAME only, base64-encode
  │   └── (custom variants forced to WebP/GIF if animated)
  │
  ├── 7. ThumbHash from first frame
  │
  └── 8-9. Same as static
```

### PDFs

```
Input
  │
  ├── 1. Detect as PDF via magic bytes
  ├── 2. Render first page to raster via poppler (Sharp's built-in PDF support)
  │      Use density: 150 for reasonable quality/speed balance
  │
  ├── 3. Extract metadata:
  │   ├── Page count (from poppler)
  │   ├── Rendered dimensions
  │   ├── File size
  │   └── (PDF-specific metadata: title, author, if accessible)
  │
  ├── 4. Process rendered first page same as a static image
  │
  └── 5. Return result (with metadata noting it's a PDF)
```

### SVGs

```
Input
  │
  ├── 1. Detect as SVG
  ├── 2. Parse and extract metadata:
  │   ├── viewBox dimensions (width/height)
  │   ├── File size
  │   ├── Has embedded fonts?
  │   ├── Has scripts? (potential XSS)
  │   └── Uses external resources?
  │
  ├── 3. Sanitize: strip <script> tags, event handlers, external references
  │      Use DOMPurify or a whitelist-based sanitizer
  │
  ├── 4. Rasterize at a sensible size for ThumbHash/tiny preview only
  │      (via librsvg through Sharp, or resvg)
  │
  ├── 5. Do NOT create resized variants (SVGs are resolution-independent)
  │
  ├── 6. Return sanitized SVG + metadata + tiny preview
  │
  └── Note: Original SVG is always kept (sanitized version saved alongside)
```

### Tiny Base64 Preview Strategy

For the 36x36 pixel preview, we want the absolute smallest base64 string that can be used in an `<img src="data:...">` tag.

**Approach:** Generate the 36x36 image in all three formats (AVIF, WebP, JPEG) and pick the smallest:

```typescript
const tiny = sharp(input).resize(36, 36, { fit: 'inside' }).removeMetadata();

const [avif, webp, jpeg] = await Promise.all([
	tiny.clone().avif({ quality: 40, effort: 2 }).toBuffer(),
	tiny.clone().webp({ quality: 40 }).toBuffer(),
	tiny.clone().jpeg({ quality: 40 }).toBuffer(),
]);

// Pick smallest
const candidates = [
	{ format: 'avif', mime: 'image/avif', buffer: avif },
	{ format: 'webp', mime: 'image/webp', buffer: webp },
	{ format: 'jpeg', mime: 'image/jpeg', buffer: jpeg },
].sort((a, b) => a.buffer.length - b.buffer.length);

const winner = candidates[0];
const data_uri = `data:${winner.mime};base64,${winner.buffer.toString('base64')}`;
// Typical size: 200-500 bytes as base64 string
```

At 36x36 pixels, the differences are small (~200-600 bytes per format), but AVIF or WebP usually win. The resulting base64 string is typically 300-800 characters -- small enough to inline in HTML or store in a database column.

### ThumbHash vs BlurHash

We use **ThumbHash** instead of BlurHash because:

| Feature                  | BlurHash                   | ThumbHash                         |
| ------------------------ | -------------------------- | --------------------------------- |
| Size                     | 20-30 chars (Base83)       | ~33 chars (Base64)                |
| Encodes aspect ratio     | No (must store separately) | Yes                               |
| Supports transparency    | No                         | Yes                               |
| Visual detail            | Lower (smudgy)             | Higher (recognizable shapes)      |
| Configuration needed     | Yes (component count)      | None (auto-determined)            |
| Average color extraction | No                         | Yes (from hash, no decode needed) |

ThumbHash provides better previews with less configuration. It's 25 bytes binary (~33 chars base64), which is tiny enough to store alongside any image record.

Both the thumbhash AND the tiny base64 preview are generated. They serve slightly different purposes:

- **ThumbHash**: Absolute smallest (33 chars), good for list views with hundreds of items
- **Tiny base64**: Slightly larger (300-800 chars) but pixel-accurate preview, good for hero images where you want the preview to look as close to the real image as possible. This can also be server side rendered because it can be simply injected into an image src tag

---

## Output Variants

### Default Variants

| Variant     | Max Dimension | Format                     | Quality | Notes                                    |
| ----------- | ------------- | -------------------------- | ------- | ---------------------------------------- |
| `default`   | 2048px        | AVIF                       | 50      | Primary viewing size. WebP for animated. |
| `thumbnail` | 640px         | AVIF                       | 50      | List/grid views. WebP for animated.      |
| `tiny`      | 36px          | smallest of AVIF/WebP/JPEG | 40      | Base64-encoded data URI                  |

### Output File Naming

R2 keys are **extensionless**. Each R2 object carries its own metadata so files can be served directly without a database lookup. The frontend can use a stable path like `/images/{id}/default` without knowing the format.

```
{prefix}/{id}/{variant_name}

Example (with default prefix 'images'):
  images/01JQ7X8K9M3N/original
  images/01JQ7X8K9M3N/default
  images/01JQ7X8K9M3N/thumbnail
```

### R2 Object Metadata

Each R2 object is stored with metadata that enables direct serving without a database lookup:

**Processed variants** (default, thumbnail, custom):

| Metadata | Type | Value | Purpose |
| --- | --- | --- | --- |
| `httpMetadata.contentType` | HTTP | e.g. `image/avif` | Browser renders correctly |
| `httpMetadata.cacheControl` | HTTP | `public, max-age=31536000, immutable` | Aggressive caching (variants are immutable, keyed by unique ID) |
| `customMetadata.width` | Custom | e.g. `"2048"` | `<img width>` without DB lookup |
| `customMetadata.height` | Custom | e.g. `"1365"` | `<img height>` without DB lookup |

**Original file:**

| Metadata | Type | Value | Purpose |
| --- | --- | --- | --- |
| `httpMetadata.contentType` | HTTP | From `File.type` at upload | Best-guess MIME until processing detects the real type |
| `customMetadata.original-filename` | Custom | e.g. `"vacation-photo.jpg"` | Display name for downloads |

Rich metadata (colors, thumbhash, aspect ratio, animation info) belongs in the database record, not on R2 objects — it's used for UI rendering, not file serving.

### Animated Image Handling

When the input is animated:

- AVIF variants fall back to animated WebP (AVIF doesn't support animation in Sharp/libvips)
- Frame count is capped at 500 frames to prevent abuse
- The tiny preview and thumbhash use only the first frame
- All frames are resized together, preserving timing/delays

### Transparency Handling

- If the input has transparency, AVIF and WebP variants preserve it
- JPEG variants (if requested) get a white background composited
- The tiny preview preserves transparency if the smallest format supports it
- ThumbHash encodes the alpha channel

---

## Metadata Extraction

All extracted metadata is returned in the `metadata` field. Here's everything Sharp + supplementary libraries can provide:

### Core Metadata (always available)

| Field                | Source                         | Description                            |
| -------------------- | ------------------------------ | -------------------------------------- |
| `file_name`          | Upload option                  | Original filename if provided, or null |
| `file_extension`     | `file_name`                    | Lowercase extension without dot        |
| `mime_type`          | `file-type` (magic bytes)      | True MIME type regardless of extension |
| `file_size`          | R2 object info                 | Size in bytes                          |
| `width`              | `sharp.metadata()`             | Pixels (after orientation correction)  |
| `height`             | `sharp.metadata()`             | Pixels (after orientation correction)  |
| `aspect_ratio`       | Computed                       | `width / height` as a float            |
| `has_transparency`   | `sharp.metadata().hasAlpha`    | Whether alpha channel exists           |
| `is_animated`        | `sharp.metadata().pages > 1`   | Whether image has multiple frames      |
| `frame_count`        | `sharp.metadata().pages`       | Number of frames                       |
| `color_space`        | `sharp.metadata().space`       | sRGB, CMYK, etc.                       |
| `bit_depth`          | `sharp.metadata().depth`       | Bits per channel                       |
| `channels`           | `sharp.metadata().channels`    | Number of channels                     |
| `background_color`     | 1x1 resize + `culori`          | Average color as OKLCH `{ l, c, h }`   |
| `background_color_css` | Computed                       | `oklch(0.65 0.04 210)` CSS string      |
| `accent_color`         | `node-vibrant` + `culori`      | Vibrant color as OKLCH `{ l, c, h }`   |
| `accent_color_css`     | Computed                       | `oklch(0.63 0.21 1)` CSS string        |
| `exif_orientation`   | `sharp.metadata().orientation` | EXIF orientation tag (1-8)             |
| `has_icc_profile`    | `sharp.metadata().hasProfile`  | ICC profile presence                   |
| `density`            | `sharp.metadata().density`     | DPI/PPI if available                   |

### Color Extraction: Background + Accent

Two colors are extracted from each image, both in OKLCH:

**Background color** -- the average color of the image, suitable for use as a placeholder background or card color. Computed by resizing the image to 1x1 pixel (Sharp's lanczos3 kernel computes a weighted mean of all pixel colors):

```typescript
import { oklch, parse } from 'culori';

// Resize to 1x1 = true average of all pixels
const { data } = await sharp(input).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
const [r, g, b] = data;
const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const bg = oklch(parse(hex));
// bg = { l: 0.65, c: 0.04, h: 210 }
// CSS: oklch(0.65 0.04 210)
```

**Accent color** -- the most visually prominent/saturated color that stands out. Computed via `node-vibrant`'s perceptual palette extraction, which uses Modified Median Cut Quantization to cluster colors and identify the "Vibrant" swatch:

```typescript
import { Vibrant } from 'node-vibrant/node';

const palette = await Vibrant.from(input).getPalette();
// Fallback chain: Vibrant > DarkVibrant > LightVibrant > Muted > null
const swatch = palette.Vibrant ?? palette.DarkVibrant ?? palette.LightVibrant ?? palette.Muted;

if (swatch) {
	const accent = oklch(parse(swatch.hex));
	// accent = { l: 0.63, c: 0.21, h: 1 }
	// CSS: oklch(0.63 0.21 1)
}
```

Both extractions run in parallel for minimal overhead.

**Why two colors?** A single "dominant" color is often a muddy average that's neither good as a background nor as an accent. Separating them gives the frontend developer exactly what they need:

```css
/* Background color: the overall feel of the image */
.image-card {
	background: oklch(0.65 0.04 210);
}

/* Accent color: the standout color for UI elements */
.image-badge {
	background: oklch(0.63 0.21 1);
}

/* Lighten the background color for a subtle card */
.image-card--subtle {
	background: oklch(0.95 0.02 210);
}
```

**Why OKLCH?**

- **Perceptually uniform**: Equal numeric changes = equal visual changes
- **Adjustable lightness**: Change `l` to make the color lighter/darker without shifting hue
- **CSS native**: `oklch()` is supported in all modern browsers
- **Gamut mapping**: Works with wide-gamut displays (Display P3)
- **Chroma sorting**: `c` directly measures saturation, making it easy to filter or rank colors

---

## Input Validation & Limits

### File Size Limits

| Input Type                              | Max Size | Rationale                                       |
| --------------------------------------- | -------- | ----------------------------------------------- |
| Standard images (JPEG, PNG, WebP, AVIF) | 50 MB    | Covers high-res photos                          |
| RAW camera files (NEF, CR2, ARW, DNG)   | 100 MB   | RAW files are large (25-80 MB typical)          |
| Animated images (GIF, animated WebP)    | 50 MB    | Animated files can be large                     |
| PDFs                                    | 50 MB    | Only first page is rendered                     |
| SVGs                                    | 5 MB     | SVGs should be small; large ones are suspicious |

### Dimension Limits

| Limit                       | Value          | Rationale                                        |
| --------------------------- | -------------- | ------------------------------------------------ |
| Max pixels (width x height) | 256 megapixels | Prevents memory exhaustion. Covers 100MP cameras |
| Max single dimension        | 32,768 px      | Beyond this is pathological                      |
| Min dimension               | 1 px           | Must be at least 1x1                             |
| Max animated frames         | 500            | Prevents abuse with very long GIFs               |

### Validation Errors

```typescript
type ImageProcessorError =
	| { code: 'FILE_TOO_LARGE'; max_bytes: number; actual_bytes: number }
	| { code: 'DIMENSIONS_TOO_LARGE'; max_megapixels: number; actual_megapixels: number }
	| { code: 'UNSUPPORTED_FORMAT'; mime_type: string; file_extension: string }
	| { code: 'TOO_MANY_FRAMES'; max_frames: number; actual_frames: number }
	| { code: 'CORRUPTED_FILE'; details: string }
	| { code: 'PROCESSING_TIMEOUT'; timeout_ms: number }
	| { code: 'SVG_MALICIOUS'; details: string }
	| { code: 'FILE_NOT_FOUND'; key: string }
	| { code: 'INTERNAL_ERROR'; details: string };
```

All errors are typed and actionable. The consumer knows exactly what went wrong and can show appropriate user-facing messages.

---

## Supported Formats

### Full Processing (resize + variants + metadata)

| Format    | Extensions   | MIME Type              | Notes                                               |
| --------- | ------------ | ---------------------- | --------------------------------------------------- |
| JPEG      | .jpg, .jpeg  | image/jpeg             | Most common. Full support.                          |
| PNG       | .png         | image/png              | Transparency preserved.                             |
| WebP      | .webp        | image/webp             | Static and animated.                                |
| AVIF      | .avif        | image/avif             | Static only (animated read unsupported by libvips). |
| GIF       | .gif         | image/gif              | Static and animated. Frame limit enforced.          |
| HEIC/HEIF | .heic, .heif | image/heic, image/heif | iPhone photos. Requires libheif in Docker image.    |
| TIFF      | .tiff, .tif  | image/tiff             | Common in print/scan workflows.                     |
| BMP       | .bmp         | image/bmp              | Legacy support.                                     |
| ICO       | .ico         | image/x-icon           | Extracts largest embedded image.                    |
| JPEG 2000 | .jp2, .j2k   | image/jp2              | Medical/archival imaging.                           |
| JPEG XL   | .jxl         | image/jxl              | Next-gen format (if libvips built with libjxl).     |

### Camera RAW (resize + variants + metadata)

| Format  | Extensions | Camera                             |
| ------- | ---------- | ---------------------------------- |
| DNG     | .dng       | Adobe Digital Negative (universal) |
| NEF     | .nef       | Nikon                              |
| CR2/CR3 | .cr2, .cr3 | Canon                              |
| ARW     | .arw       | Sony                               |
| RAF     | .raf       | Fujifilm                           |
| ORF     | .orf       | Olympus                            |
| RW2     | .rw2       | Panasonic                          |
| PEF     | .pef       | Pentax                             |

RAW support via libraw (native in libvips 8.18+). Covers 1000+ camera models.

### Special Handling

| Format | Extensions  | Processing                                                                          |
| ------ | ----------- | ----------------------------------------------------------------------------------- |
| PDF    | .pdf        | First page rendered to raster. Metadata extracted. No resize of original.           |
| SVG    | .svg, .svgz | Metadata extracted. Sanitized. No resize variants. Tiny preview from rasterization. |

### Explicitly Unsupported

| Type                           | Reason                                                  |
| ------------------------------ | ------------------------------------------------------- |
| Video (.mp4, .mov, .avi, etc.) | Out of scope. Use a video processing service.           |
| Audio (.mp3, .wav, etc.)       | Out of scope.                                           |
| 3D models (.obj, .gltf, etc.)  | Out of scope.                                           |
| Photoshop (.psd)               | Possible via ImageMagick but unreliable. May add later. |
| AI/EPS                         | Vector formats better handled by dedicated tools.       |

---

## Configuration

### Environment Variables

```toml
# wrangler.toml
[vars]
IMAGE_PROCESSOR_MAX_FILE_SIZE = "52428800"     # 50MB default
IMAGE_PROCESSOR_KEEP_ORIGINAL = "true"          # Keep originals by default
IMAGE_PROCESSOR_SLEEP_AFTER = "5m"              # Container idle timeout
```

Variant-specific options (dimensions, quality, effort) are configured programmatically via the `variants` array in `ProcessImageOptions`, not via environment variables. This keeps the config type-safe and colocated with the code that uses it.

### Programmatic Configuration

```typescript
import { ImageProcessorContainer, processImage } from '@delightstack/image-processor';

// Re-export for Cloudflare to discover
export { ImageProcessorContainer };

export default {
	async fetch(request: Request, env: Env) {
		const result = await processImage(env.IMAGE_PROCESSOR, {
			bucket: env.MEDIA_BUCKET,
			key: 'uploads/photo.jpg',
			keep_original: true,
			// Override default variants or add custom ones
			variants: [
				{ name: 'default', max_dimension: 2048, format: 'avif', quality: 50, effort: 4 },
				{ name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4 },
				{ name: 'social', max_dimension: 1200, format: 'jpeg', quality: 85 },
				{ name: 'banner', max_dimension: 1920, format: 'webp', quality: 75 },
			],
		});
		return Response.json(result);
	},
};
```

---

## Container Internals

### Docker Image

```dockerfile
FROM oven/bun:alpine AS builder

# Install build dependencies for custom libvips with full format support
RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
    build-base meson ninja pkgconf glib-dev expat-dev \
    # Core codecs
    libjpeg-turbo-dev libpng-dev libwebp-dev \
    # AVIF
    aom-dev \
    # HEIC/HEIF
    libheif-dev libde265-dev x265-dev \
    # PDF rendering
    poppler-dev \
    # SVG rendering
    librsvg-dev \
    # RAW camera formats
    libraw-dev \
    # GIF
    cgif-dev \
    # TIFF
    libtiff-dev \
    # Color management
    lcms2-dev \
    # Other
    fftw-dev

# Build libvips 8.18 from source (or use Alpine edge package if available)
# ... (build steps)

FROM oven/bun:alpine AS runtime

# Copy compiled libvips and runtime dependencies
RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
    glib expat \
    libjpeg-turbo libpng libwebp libwebpdemux libwebpmux \
    aom-libs \
    libheif libde265 x265-libs \
    poppler poppler-glib \
    librsvg \
    libraw \
    cgif \
    libtiff \
    lcms2 \
    fftw-double-libs

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY . .

EXPOSE 8080
CMD ["bun", "run", "server.ts"]
```

**Architecture:** `linux/amd64` (Cloudflare Containers requirement)

**Expected image size:** ~250-350 MB (Bun + libvips + all codec libraries). This fits comfortably within even the `lite` instance type's 2 GB disk.

**Instance type recommendation:**

- `standard-1` (0.5 vCPU, 4 GiB RAM) for most workloads
- `standard-2` (1 vCPU, 6 GiB RAM) for processing very large RAW files or high-throughput scenarios

### Container HTTP Server

The container runs a minimal HTTP server (Bun's built-in `Bun.serve()`) with a single endpoint:

```
POST /process
Content-Type: multipart/form-data

- Part 1: JSON options (processing config)
- Part 2: Binary image data

Response: multipart/form-data
- Part 1: JSON result (metadata + variant info)
- Part 2+: Binary variant data (one part per variant)
```

Since the DO handles all R2 I/O, the container only needs one endpoint:

```
POST /process
Content-Type: application/octet-stream
X-Options: base64-encoded JSON options
Body: raw image bytes

Response:
Content-Type: multipart/mixed
- Part 1: JSON metadata + variant info
- Part 2: default variant binary
- Part 3: thumbnail variant binary
- Part 4: (additional variant binaries)
```

The DO receives this multipart response, writes each variant to R2, and returns the final `ProcessImageResult` to the worker via RPC.

### Processing Timeout

The container enforces a 60-second processing timeout per image. If processing takes longer (which would be exceptional -- even 100 MP RAW files process in ~10-15 seconds), it returns an error.

---

## Cloudflare Integration

### Wrangler Configuration (Full Example)

```toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2025-02-01"

# Image processor container
[[containers]]
class_name = "ImageProcessorContainer"
image = "node_modules/@delightstack/image-processor/docker"
max_instances = 5
instance_type = "standard-1"

# Durable Object binding for the container
[[durable_objects.bindings]]
name = "IMAGE_PROCESSOR"
class_name = "ImageProcessorContainer"

# Required migration
[[migrations]]
tag = "v1"
new_sqlite_classes = ["ImageProcessorContainer"]

# R2 bucket for media storage
[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "my-media"

# Observability
[observability]
enabled = true
```

### S3-Compatible Storage (Non-R2)

For S3-compatible buckets other than R2, the standalone `processImage()` accepts an S3 config:

```typescript
const result = await processImage(env.IMAGE_PROCESSOR, {
	s3: {
		endpoint: 'https://s3.us-east-1.amazonaws.com',
		access_key_id: env.AWS_ACCESS_KEY_ID,
		secret_access_key: env.AWS_SECRET_ACCESS_KEY,
		bucket: 'my-bucket',
		region: 'us-east-1',
	},
	key: 'uploads/photo.jpg',
});
```

When using R2 (the default and recommended), no credentials are needed -- the R2 bucket binding handles auth natively. The database integration (`imageProcessing()`) uses R2 bindings exclusively.

### Scaling Considerations

**Single Container (default):**

- One container instance handles all requests sequentially
- Good for low-to-moderate traffic (up to ~100-200 images/hour depending on size)
- Images queue up while the container is processing

**Multiple Containers:**

- Set `max_instances` higher in wrangler.toml
- Use different DO IDs to route to different container instances
- The `imageProcessing()` helper can auto-distribute using a round-robin or hash-based strategy internally

**Scale-to-zero:** Containers automatically sleep after the configured `sleepAfter` period (default 5 minutes). Billing stops during sleep. Cold start on next request is ~2-3 seconds.

---

## Delightstack Integration

### Design Philosophy

The `@delightstack/image-processor` does NOT depend on `@delightstack/database`. It works standalone. But the large majority of users will use both packages together, so the integration is optimized for that case.

The key problem: the database lives in one DO, and the container lives in another DO. Making them talk is inherently cross-DO communication. Rather than forcing the user to wire this up themselves, the `imageProcessing()` factory creates a helper object that encapsulates all the orchestration logic and runs inside the database DO.

### The `imageProcessing()` Helper

```typescript
import { imageProcessing } from '@delightstack/image-processor';

class AppDatabase extends DatabaseServer<typeof dbConfig> {
	readonly images = imageProcessing(this, {
		container: () => this.env.IMAGE_PROCESSOR,
		bucket: () => this.env.MEDIA_BUCKET,
	});
}
```

This creates a helper with these methods:

```typescript
interface ImageProcessingHelper {
	/**
	 * Save the original file to R2, create a pending image record,
	 * and schedule an alarm for processing.
	 *
	 * Accepts a File (auto-extracts file_name), ReadableStream, or ArrayBuffer.
	 *
	 * Generates a unique ID used for both the record and R2 keys:
	 *   {prefix}/{id}/original   ← raw upload
	 *   {prefix}/{id}/default    ← processed variant (after alarm)
	 *   {prefix}/{id}/thumbnail  ← processed variant (after alarm)
	 */
	upload(
		data: File | ReadableStream | ArrayBuffer,
		options?: UploadOptions,
	): Promise<ImageRecord>;

	/**
	 * Delete an image and all its variants from R2.
	 * If the image is currently being processed, processAlarm()
	 * will detect the deletion and clean up any newly created files.
	 */
	delete(image_id: string): void;

	/** Re-process a failed image */
	retry(image_id: string): void;

	/** Check processing status */
	getStatus(image_id: string): ImageRecord;

	/**
	 * Process pending images. Call this from your alarm() handler.
	 *
	 * Cloudflare Durable Objects have exactly ONE alarm handler and ONE
	 * pending alarm at a time. The imageProcessing() helper does NOT
	 * override or hijack alarm() — you must wire it up yourself:
	 *
	 * ```typescript
	 * async alarm() {
	 *   await this.images.processAlarm();
	 * }
	 * ```
	 *
	 * This processes up to 10 pending images per invocation. If more
	 * remain, it schedules another alarm using a "set only if earlier"
	 * strategy that won't overwrite a closer alarm set by other code.
	 */
	processAlarm(): Promise<void>;
}
```

**How this works internally:**
- `imageProcessing()` receives a reference to the `DatabaseServer` instance.
- It uses `this.db.create()`, `this.db.update()`, `this.db.get()`, `this.db.delete()` for all database operations — it's just calling the existing database methods.
- It accesses the Container DO binding and R2 bucket via the lazy getters `container()` and `bucket()`.
- It exposes `processAlarm()` which the user calls from their DO's `alarm()` handler.

The helper is not a mixin and does not modify the class hierarchy or the alarm handler. It's a plain object with methods that close over the `DatabaseServer` instance. The user wires it into their alarm handler explicitly.

### Alarm-Based Processing

**Constraint:** Cloudflare Durable Objects have exactly **one** `alarm()` handler and **one** pending alarm at a time. Calling `setAlarm()` overwrites any existing alarm. The `alarm()` method receives no context about what triggered it — just `retryCount` and `isRetry`.

Because of this, the `imageProcessing()` helper does **not** override or monkey-patch `alarm()`. Instead, it provides a `processAlarm()` method that the user calls from their own `alarm()` handler. This gives the user full control over alarm composition:

```typescript
class AppDatabase extends DatabaseServer<typeof dbConfig> {
	readonly images = imageProcessing(this, { /* ... */ });

	async alarm() {
		// Image processing: processes pending images, reschedules if more remain
		await this.images.processAlarm();

		// Your own alarm-based work (optional):
		// await this.cleanupExpiredSessions();
		// await this.sendScheduledNotifications();
	}
}
```

**Alarm scheduling uses a "set only if earlier" strategy.** Both `upload()` and `processAlarm()` check the existing alarm before calling `setAlarm()`:

```typescript
const existing = await this.db.ctx.storage.getAlarm();
if (existing === null || Date.now() < existing) {
	await this.db.ctx.storage.setAlarm(Date.now());
}
```

This means:
- If no alarm is pending, one is set for immediate execution.
- If an alarm is already pending for later, it's moved earlier (so images start processing sooner).
- If an alarm is already pending for now or sooner, nothing changes.
- Your own code can also call `setAlarm()` safely — the alarm handler runs all concerns regardless of what triggered it.

**Processing flow:**

1. `upload()` creates a record with `processing_status = 'pending'` and ensures an alarm is scheduled
2. When the alarm fires, the user's `alarm()` calls `this.images.processAlarm()`
3. `processAlarm()` queries the `image` table for pending records (up to 10 per cycle)
4. For each: marks it `'processing'`, calls the Container DO via RPC, writes variants to R2
5. On success: updates the record to `'processed'` with all metadata
6. On failure: updates the record to `'failed'` with an error code
7. If the image record was deleted during processing: cleans up variant files from R2
8. If more pending images remain, schedules another alarm (using "set only if earlier")

This makes the system self-healing. If the DO restarts, the alarm fires again and retries any images stuck in `'pending'` or `'processing'` state.

### Database Schema

```typescript
import { defineImageTable } from '@delightstack/image-processor';

const dbConfig = {
	image: defineImageTable(),
};
```

Creates this table:

```sql
CREATE TABLE image (
  id TEXT PRIMARY KEY,                  -- Timestamp-based ID (also used in R2 keys)
  base_path TEXT NOT NULL,              -- R2 path prefix: {prefix}/{id}
  file_name TEXT,                       -- Original filename if provided (metadata only)
  processing_status TEXT NOT NULL,      -- 'pending' | 'processing' | 'processed' | 'failed'
  error_code TEXT,                      -- Error code if failed

  -- Populated after processing (nullable while pending)
  mime_type TEXT,                       -- Detected MIME type
  file_size INTEGER,                   -- Original file size in bytes
  width INTEGER,                       -- Original width (orientation-corrected)
  height INTEGER,                      -- Original height (orientation-corrected)
  aspect_ratio REAL,                   -- width/height float
  has_transparency INTEGER,            -- 0 or 1
  is_animated INTEGER,                 -- 0 or 1
  frame_count INTEGER,                 -- Number of frames
  background_color_l REAL,             -- Background OKLCH lightness
  background_color_c REAL,             -- Background OKLCH chroma
  background_color_h REAL,             -- Background OKLCH hue
  accent_color_l REAL,                 -- Accent OKLCH lightness (nullable for achromatic images)
  accent_color_c REAL,                 -- Accent OKLCH chroma
  accent_color_h REAL,                 -- Accent OKLCH hue
  thumbhash TEXT,                      -- ThumbHash base64
  tiny_preview TEXT,                   -- Base64 data URI
  variants TEXT,                       -- JSON array of variant info (includes 'original' if kept)

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Note: Most metadata fields are nullable because they're populated asynchronously after processing completes. Only `id`, `base_path`, and `processing_status` are guaranteed at upload time. `file_name` is optional metadata provided by the caller.

### Full End-to-End Example

```typescript
// === src/database.ts ===
import { DatabaseServer } from '@delightstack/database';
import {
	ImageProcessorContainer,
	imageProcessing,
	defineImageTable,
} from '@delightstack/image-processor';

export { ImageProcessorContainer };

const dbConfig = {
	image: defineImageTable(),
	post: definePostTable(), // your app's tables
};

export class AppDatabase extends DatabaseServer<typeof dbConfig> {
	readonly images = imageProcessing(this, {
		container: () => this.env.IMAGE_PROCESSOR,
		bucket: () => this.env.MEDIA_BUCKET,
		keep_original: true,
	});

	constructor(ctx: DurableObjectState, env: Env) {
		super(dbConfig, () => null, ctx, env);
	}

	async alarm() {
		await this.images.processAlarm();
	}
}

// === src/index.ts ===
export default {
	async fetch(request: Request, env: Env) {
		const db = env.APP_DATABASE.getByName('main');

		// Upload
		if (request.method === 'POST' && url.pathname === '/images') {
			const formData = await request.formData();
			const file = formData.get('file') as File;

			const image = await db.images.upload(file);
			return new Response(null, {
				status: 201,
				headers: { Location: `/images/${image.id}` },
			});
		}

		// Get image (works immediately — shows pending status or full metadata)
		if (request.method === 'GET' && url.pathname.startsWith('/images/')) {
			const id = url.pathname.split('/').pop()!;
			const image = await db.images.getStatus(id);
			return Response.json(image);
		}

		// Delete image (cleans up variants from R2 too)
		if (request.method === 'DELETE' && url.pathname.startsWith('/images/')) {
			const id = url.pathname.split('/').pop()!;
			await db.images.delete(id);
			return new Response(null, { status: 204 });
		}
	},
};
```

### Why Not Merge the Container into the Database DO?

You might wonder: why not have the database DO also be the Container? Two reasons:

1. **Cloudflare architecture**: A Container class IS a Durable Object. You can't have a single class extend both `DatabaseServer` (which extends `DurableObject`) and `Container` (which also extends `DurableObject`). They're separate DOs by necessity.

2. **Separation of concerns**: The database DO may have thousands of instances (one per user/org). The container is a heavy Docker VM that should have a small pool of instances. Coupling them would mean spinning up a Docker container for every database DO instance, which is wasteful and expensive.

The `imageProcessing()` helper bridges this gap cleanly. From the user's perspective, `db.images.upload(file)` is a single call that handles ID generation, R2 storage, record creation, and alarm scheduling. The cross-DO communication is an implementation detail they never see.

---

## Error Handling

### Error Hierarchy

```typescript
class ImageProcessorError extends Error {
	code: string;
	status: number;
	details?: Record<string, unknown>;
}

// Validation errors (4xx) -- the input is bad
class ValidationError extends ImageProcessorError {
	status = 400;
}

// Processing errors (5xx) -- something went wrong during processing
class ProcessingError extends ImageProcessorError {
	status = 500;
}

// Timeout errors (504) -- processing took too long
class TimeoutError extends ImageProcessorError {
	status = 504;
}
```

### Error Codes

| Code                    | HTTP Status | When                                      |
| ----------------------- | ----------- | ----------------------------------------- |
| `FILE_NOT_FOUND`        | 404         | R2 key doesn't exist                      |
| `FILE_TOO_LARGE`        | 400         | Exceeds size limit                        |
| `DIMENSIONS_TOO_LARGE`  | 400         | Exceeds pixel limit                       |
| `UNSUPPORTED_FORMAT`    | 400         | Unrecognized or blocked format            |
| `TOO_MANY_FRAMES`       | 400         | Animated image exceeds frame limit        |
| `CORRUPTED_FILE`        | 400         | Can't decode the image                    |
| `SVG_MALICIOUS`         | 400         | SVG contains scripts or dangerous content |
| `PROCESSING_TIMEOUT`    | 504         | Took longer than 60 seconds               |
| `CONTAINER_UNAVAILABLE` | 503         | Container failed to start                 |
| `INTERNAL_ERROR`        | 500         | Unexpected error                          |

---

## Cost & Performance Characteristics

### Processing Time Estimates

| Input                     | Size   | Estimated Time |
| ------------------------- | ------ | -------------- |
| JPEG photo (12MP)         | 5 MB   | 1-3 seconds    |
| PNG with transparency     | 10 MB  | 2-4 seconds    |
| HEIC from iPhone (48MP)   | 8 MB   | 3-5 seconds    |
| Camera RAW (NEF, 45MP)    | 50 MB  | 5-10 seconds   |
| Animated GIF (100 frames) | 20 MB  | 5-15 seconds   |
| PDF (first page)          | 10 MB  | 2-5 seconds    |
| SVG (metadata only)       | 100 KB | <0.5 seconds   |

Add ~2-3 seconds for cold start if the container was sleeping.

### Cost Estimates (Cloudflare Containers Pricing)

Using `standard-1` instance (0.5 vCPU, 4 GiB RAM):

| Scenario                                             | Monthly Cost  |
| ---------------------------------------------------- | ------------- |
| 100 images/day, container sleeps most of the time    | ~$2-5/month   |
| 1,000 images/day, container active ~4 hours          | ~$10-20/month |
| 10,000 images/day, container active most of the time | ~$40-80/month |

Plus: Workers requests ($0.30/million), R2 storage ($0.015/GB/month), R2 operations ($4.50/million Class A writes).

Costs are dominated by R2 storage and egress for most workloads, not the container compute.

---

## Technology Choices

### Why Bun + Sharp (not Node.js, Rust, Go, or Python)

| Factor                      | Bun + Sharp                                            | Rust                                            | Go                               | Python                         |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------- | -------------------------------- | ------------------------------ |
| **Processing engine**       | libvips (via Sharp)                                    | image-rs or libvips FFI                         | bimg (libvips)                   | Pillow or pyvips               |
| **Format breadth**          | Excellent (all via libvips)                            | Limited (no HEIC, no PDF, no RAW without C FFI) | Same as Sharp (both use libvips) | Good (via Pillow plugins)      |
| **Performance**             | Excellent (C-level via libvips, fast startup via Bun)  | Excellent (native)                              | Excellent (C-level via libvips)  | Slower (GIL + Python overhead) |
| **Memory efficiency**       | Excellent (libvips streaming)                          | Good                                            | Excellent (libvips streaming)    | Poor (Pillow loads full image) |
| **Ecosystem for this task** | Best (sharp, file-type, culori, thumbhash, node-vibrant all npm) | Fragmented                          | Decent                           | Rich but slow                  |
| **Docker image size**       | ~300 MB                                                | ~200 MB                                         | ~250 MB                          | ~400 MB                        |
| **Developer familiarity**   | Matches rest of Delightstack (TypeScript)              | Different language                              | Different language               | Different language             |
| **Community/maintenance**   | Sharp: 29K stars, very active                          | image-rs: 5K stars                              | bimg: 4K stars                   | Pillow: 12K stars              |

**Decision: Bun + Sharp.** Same language as the rest of Delightstack (TypeScript). Bun provides faster startup times and native TypeScript execution (no build step in the container). Sharp has the best libvips binding, the largest community, and the richest ecosystem of complementary packages. The container runs in Docker so we have full access to native dependencies (no Cloudflare Workers restrictions).

### Why ThumbHash (not BlurHash)

ThumbHash is strictly superior: encodes more detail, supports transparency, includes aspect ratio, requires no configuration, and is similarly tiny (~33 chars base64 vs ~25 chars for BlurHash).

### Why OKLCH for Colors (not hex/RGB/HSL)

- Perceptually uniform (adjusting lightness gives predictable visual results)
- Native CSS support (`oklch()`)
- `l` controls lightness, `c` controls saturation -- trivial to create light/dark/muted variations
- Future-proof (part of CSS Colors Level 4)

### Why AVIF as Default Output (not WebP or JPEG)

- AVIF at quality 50 matches JPEG at quality 80-85 perceptually, at ~50% the file size
- AVIF at quality 50 is ~20-30% smaller than WebP at equivalent visual quality
- All modern browsers support AVIF (Chrome, Firefox, Safari 16+, Edge)
- AVIF supports transparency, wide color gamut, and HDR
- For animated content, we fall back to WebP (AVIF animation support is immature)

---

## Open Questions

### 1. Container Instance Strategy

Should we use a single shared container or per-user/per-request containers?

- **Single shared** (recommended): One container instance serves all requests sequentially. Simpler. Good for most workloads. Cold start only affects the very first request.
- **Per-request**: Each processing job gets its own container. Maximum parallelism but higher cold-start overhead and cost.
- **Pool**: Small pool of containers (3-5) with round-robin distribution. Good balance for higher throughput.

Recommendation: Start with a single shared container. Add pooling later if throughput becomes a bottleneck.

### 2. Alarm Concurrency and Rate Limiting

The alarm handler processes pending images sequentially within a single DO instance. For batch uploads (e.g., 50 images at once), they'll be processed one-at-a-time per alarm invocation (with batching of ~10 per alarm cycle).

Should we:
- Process multiple images per alarm cycle in parallel? (risk: memory pressure)
- Rate-limit how many images can be queued per DO? (prevent abuse)
- Use multiple container instances for parallelism? (adds complexity)

Recommendation: Start with sequential processing (simple, predictable). Add parallelism later if throughput becomes a bottleneck.

### 3. Image Optimization Profiles

Should we provide named profiles for common use cases?

```typescript
// E-commerce product images
processImage(env.IMAGE_PROCESSOR, {
  profile: 'ecommerce',  // 2048 default + 640 thumb + 120 tiny + white bg
  ...
});

// User avatars
processImage(env.IMAGE_PROCESSOR, {
  profile: 'avatar',  // 512 default + 128 thumb + square crop
  ...
});

// Blog/CMS content images
processImage(env.IMAGE_PROCESSOR, {
  profile: 'content',  // 1920 default + 640 thumb + social share variant
  ...
});
```

### 4. Image Cropping

Should the processor support cropping (e.g., square crop for avatars)?

Currently the design only "fits" images inside a max dimension (no cropping). Smart cropping (attention-based or face-detection) is more complex. Could be a future addition.

---

## Future Features

### Phase 2 (After Initial Release)

- **Batch processing** via Cloudflare Queues
- **WebP fallback variants** (opt-in)
- **Smart cropping** (attention-based crop for thumbnails)
- **Image optimization profiles** (avatar, ecommerce, content, social)
- **Progress reporting** via WebSocket for large files
- **Watermarking** (text or image overlay)
- **EXIF preservation option** (for photographers who want to keep camera data)

### Phase 3 (Later)

- **Face detection** for smart avatar cropping
- **NSFW detection** via a lightweight ML model
- **Perceptual deduplication** (detect near-duplicate uploads)
- **Image comparison** (diff two images for visual regression testing)
- **Animated AVIF** output (when libvips adds support)
- **PSD/AI support** via ImageMagick fallback
- **JPEG XL** output (when browser support improves)
- **On-the-fly resizing** (like Cloudflare Images) via a URL-based API

---

## Package Structure

```
packages/image-processor/
├── DESIGN.md                  # This document
├── package.json
├── tsconfig.json
│
├── docker/                    # Container image
│   ├── Dockerfile
│   ├── package.json           # Container's own dependencies (sharp, file-type, etc.)
│   ├── server.ts              # HTTP server that processes images
│   ├── pipeline.ts            # Core processing pipeline
│   ├── metadata.ts            # Metadata extraction
│   ├── variants.ts            # Variant generation
│   ├── thumbhash.ts           # ThumbHash generation
│   ├── colors.ts              # Background + accent color extraction + OKLCH conversion
│   ├── svg.ts                 # SVG-specific handling (sanitization, metadata)
│   ├── pdf.ts                 # PDF-specific handling (first page rendering)
│   ├── validation.ts          # Input validation (size, dimensions, format)
│   └── mime.ts                # MIME type detection from magic bytes
│
├── src/                       # Worker-side code (imported by consuming apps)
│   ├── index.ts               # Main exports
│   ├── container.ts           # ImageProcessorContainer class (DO + Container)
│   ├── process.ts             # processImage() standalone helper (Mode 2)
│   ├── integration.ts         # imageProcessing() factory for DatabaseServer (Mode 1)
│   ├── schema.ts              # defineImageTable() for @delightstack/database
│   ├── types.ts               # All TypeScript types
│   └── errors.ts              # Error classes
│
└── tests/
    ├── pipeline.test.ts       # Unit tests for processing pipeline
    ├── validation.test.ts     # Unit tests for input validation
    ├── integration.test.ts    # Integration tests with miniflare
    └── fixtures/              # Test images in various formats
        ├── photo.jpg
        ├── transparent.png
        ├── animated.gif
        ├── iphone.heic
        ├── document.pdf
        ├── icon.svg
        └── camera.nef
```

---

## Summary

This package aims to make image processing on Cloudflare as simple as:

```typescript
// With @delightstack/database — async, non-blocking
const image = await db.images.upload(file);
// Saves original to R2, returns immediately. Processing happens in the background.
// image.processing_status === 'pending'
// Later: 'processed' with all metadata, variants, thumbhash, colors, etc.

// Standalone — synchronous, blocking
const result = await processImage(env.IMAGE_PROCESSOR, {
	bucket: env.MEDIA_BUCKET,
	key: 'uploads/photo.jpg',
});
// result.thumbhash → "3OcRJYB4d3h/iIeHeEh3eIhw+j2w"
// result.tiny_preview → "data:image/avif;base64,AAAAIG..."
// result.metadata.background_color_css → "oklch(0.65 0.04 210)"
// result.metadata.accent_color_css → "oklch(0.63 0.21 1)"
// result.variants[0].key → "images/01JQ7X8K9M3N/default"
```

You give it a bucket and a key. It gives you back everything you need to display that image beautifully on a website, including instant placeholder previews, optimized variants, and rich metadata. No webhooks. No polling. No configuration beyond the basics. With the database integration, the user doesn't even wait -- upload returns immediately and processing happens in the background.
