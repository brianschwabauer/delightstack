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
- [Svelte Image Component](#svelte-image-component)
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
5. **`createImageHandle()`** -- SvelteKit server hook factory for serving images from R2 on your own domain.
6. **`Image`** -- Svelte 5 component for displaying images with progressive thumbhash placeholders and responsive srcset.
7. **`decodeThumbHash()`** -- Helper to decode a base64 thumbhash to a `data:image/png` URL. Works server-side.
8. **`imageURL()`** -- Helper to build CDN URLs for image variants.

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

That's it. One call. The user uploads a file and gets a 201 back. The `upload()` method generates a unique ID, saves the original to R2 at `/{prefix}/{id}/original`, creates the pending record, and schedules an alarm for processing. The image record transitions from `'pending'` → `'processing'` → `'processed'` (or `'failed'`). The frontend can show the thumbhash placeholder as soon as the record is marked `'processed'`.

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
	readonly images = imageProcessing(this, {
		/* ... */
	});

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

			// The container handles variant skipping (based on original dimensions)
			// and compress_original (full-res AVIF re-encode with metadata preserved).
			const result = await containerStub.process(await input.arrayBuffer(), {
				variants: this.options.variants, // VariantConfig[] with fit field
				compress_original: this.options.compress_original ?? true,
			});

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

			// If compress_original is true (default), replace the raw upload
			// with the compressed original returned by the container
			if (result.compressed_original) {
				await this.options.bucket().put(
					`${image.base_path}/original`,
					result.compressed_original.data,
					{
						httpMetadata: {
							contentType: result.compressed_original.mime_type,
							cacheControl: 'public, max-age=31536000, immutable',
						},
						customMetadata: {
							width: String(result.compressed_original.width),
							height: String(result.compressed_original.height),
							...(image.file_name ? { 'original-filename': image.file_name } : {}),
						},
					},
				);
			}

			// Update the image record with all metadata
			this.db.update('image', image.id, {
				processing_status: 'processed',
				...result.metadata,
				thumbhash: result.thumbhash,
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
		options?: {
			variants?: VariantConfig[];
			compress_original?: boolean;
			avatar?: boolean;
		},
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
	 * Whether to re-encode the original at full resolution as AVIF.
	 * Default: true. Only applies when keep_original is true.
	 *
	 * When true, the "original" stored in R2 is a full-resolution AVIF
	 * re-encode (preserving EXIF/ICC metadata) rather than the raw upload.
	 * This significantly reduces storage for large camera uploads
	 * (e.g. 8 MB JPEG → 3 MB AVIF at full resolution).
	 *
	 * When false, the raw uploaded file is kept as-is.
	 */
	compress_original?: boolean;

	/**
	 * Custom variant configuration. If omitted, uses these defaults:
	 * - { name: 'default', max_dimension: 2048, format: 'avif', quality: 50, effort: 4, fit: 'inside' }
	 * - { name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4, fit: 'cover' }
	 *
	 * The thumbhash is always generated regardless of variants.
	 * Variants whose max_dimension exceeds the original's long edge are skipped.
	 */
	variants?: VariantConfig[];

	/**
	 * Enable avatar mode: face-aware square crop, keep_original defaults to false,
	 * single thumbnail variant (640px). See "Avatar Profile" section.
	 *
	 * Explicit options (keep_original, variants, etc.) override avatar defaults.
	 */
	avatar?: boolean;
}

interface VariantConfig {
	/** Unique name for this variant (used in output key and result lookup) */
	name: string;

	/** Maximum dimension in pixels. Behavior depends on `fit`. */
	max_dimension: number;

	/** Output format. For animated inputs, 'avif' automatically falls back to 'webp'. */
	format: 'avif' | 'webp' | 'jpeg' | 'png';

	/** Quality (1-100). Default: 50 for AVIF, 75 for WebP, 80 for JPEG, lossless for PNG */
	quality?: number;

	/** Encoding effort (0-9, higher = slower + better compression). Only applies to AVIF. Default: 4 */
	effort?: number;

	/**
	 * Resize strategy.
	 *
	 * - 'inside': The long edge fits within max_dimension (image fits inside a square box).
	 *   A 4000x3000 photo at max_dimension: 2048 → 2048x1536.
	 *   Default for variants with max_dimension > 1024.
	 *
	 * - 'cover': The short edge fits within max_dimension (no cropping, just resize).
	 *   A 4000x3000 photo at max_dimension: 640 → 854x640.
	 *   Guarantees the image is always at least max_dimension pixels on its shortest side.
	 *   Default for variants with max_dimension <= 1024.
	 */
	fit?: 'inside' | 'cover';
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

	/**
	 * Whether to re-encode the original at full resolution as AVIF.
	 * Default: true. Only applies when keep_original is true.
	 * See ProcessImageOptions.compress_original for details.
	 */
	compress_original?: boolean;

	/** Custom variant configuration. If omitted, uses the default variants. */
	variants?: VariantConfig[];

	/**
	 * Enable avatar mode: face-aware square crop, keep_original defaults to false,
	 * single thumbnail variant (640px). See "Avatar Profile" section.
	 *
	 * Explicit options (keep_original, variants, etc.) override avatar defaults.
	 */
	avatar?: boolean;
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

	/**
	 * ThumbHash as a base64 string (~33 chars, encodes aspect ratio + transparency).
	 * Use thumbHashToDataURL(thumbhash) to generate a placeholder image —
	 * works server-side (pure JS, no canvas) for SSR.
	 */
	thumbhash: string;

	/**
	 * The generated output variants.
	 * If keep_original is true (default), the original is included as a variant
	 * with name: 'original'. When compress_original is true (default), the
	 * "original" is a full-resolution AVIF re-encode with EXIF/ICC metadata
	 * preserved. When compress_original is false, it's the raw uploaded file.
	 *
	 * Variants whose max_dimension exceeds the original's long edge are skipped
	 * (the image is already smaller than the variant would produce).
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

	/**
	 * Average perceived brightness (0-1).
	 * This is the `l` (lightness) component of the background_color OKLCH value.
	 * Useful for deciding whether to overlay light or dark text on the image.
	 * 0 = pure black, 1 = pure white. Values below ~0.5 suggest light text.
	 */
	luminance: number;

	/**
	 * Date/time the photo was taken, from EXIF DateTimeOriginal.
	 * ISO 8601 string (e.g. "2024-08-15T14:30:00").
	 * Null if no EXIF date is present (e.g. screenshots, generated images).
	 */
	date_taken: string | null;

	/**
	 * GPS latitude from EXIF, in decimal degrees (e.g. 48.8566 for Paris).
	 * Positive = north, negative = south. Null if no GPS data.
	 */
	gps_latitude: number | null;

	/**
	 * GPS longitude from EXIF, in decimal degrees (e.g. 2.3522 for Paris).
	 * Positive = east, negative = west. Null if no GPS data.
	 */
	gps_longitude: number | null;

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

	/** Fit strategy used: 'inside' (long edge) or 'cover' (short edge). Absent for 'original'. */
	fit?: 'inside' | 'cover';
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
  ├── 5a. [avatar: true only] Face-aware square crop (see Avatar Profile section)
  │
  ├── 6. Generate variants (skip any where original's long edge < max_dimension):
  │   ├── "default" → fit inside 2048px, AVIF q50 effort 4, strip metadata
  │   ├── "thumbnail" → fit cover 640px, AVIF q50 effort 4, strip metadata
  │   └── (any custom variants from config)
  │
  ├── 7. Generate ThumbHash from resized preview
  │
  ├── 8. Original: compress (full-res AVIF, preserve EXIF/ICC), keep raw, or delete per config
  │
  └── 9. Return result
```

### Animated Images (GIF, animated WebP, APNG)

```
Input
  │
  ├── 1-5. Same as static (metadata from first frame)
  │
  ├── 6. Generate variants (skip any where original's long edge < max_dimension):
  │   ├── "default" → fit inside 2048px, animated WebP (AVIF doesn't support animation)
  │   ├── "thumbnail" → fit cover 640px, animated WebP
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
  ├── 4. Rasterize at a sensible size for ThumbHash only
  │      (via librsvg through Sharp, or resvg)
  │
  ├── 5. Do NOT create resized variants (SVGs are resolution-independent)
  │
  ├── 6. Return sanitized SVG + metadata + thumbhash
  │
  └── Note: Original SVG is always kept (sanitized version saved alongside)
```

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

### ThumbHash as Placeholder Image

The `thumbHashToDataURL()` function generates a PNG data URL from a thumbhash — **pure JS, no canvas, no DOM.** This works on Cloudflare Workers and in SvelteKit server hooks, enabling server-side rendered placeholders with zero flash.

```svelte
<script>
	import { thumbHashToDataURL } from 'thumbhash';
</script>

<!-- Server-rendered placeholder — no client JS needed, no layout shift -->
<img
	src={thumbHashToDataURL(image.thumbhash)}
	width={image.width}
	height={image.height}
	alt="" />
```

The decoded image is ~32x32 pixels (dimensions are embedded in the hash, not related to the original image size). When scaled up by the browser, it looks like a smooth blurry preview — the right colors and shapes.

For fullscreen hero images, add a CSS blur to smooth any banding from the extreme upscale:

```svelte
<!-- Hero image with smooth placeholder -->
<img
	src={thumbHashToDataURL(image.thumbhash)}
	style="filter: blur(20px); transform: scale(1.1)"
	width={image.width}
	height={image.height}
	alt="" />
```

The `scale(1.1)` prevents blurred edges from being visible. For cards, grids, and thumbnails, the raw thumbhash looks fine without blur.

---

## Output Variants

### Default Variants

| Variant     | Max Dimension | Fit      | Format | Quality | Notes                                                                   |
| ----------- | ------------- | -------- | ------ | ------- | ----------------------------------------------------------------------- |
| `default`   | 2048px        | `inside` | AVIF   | 50      | Long edge fits. Primary viewing size. WebP for animated.                |
| `thumbnail` | 640px         | `cover`  | AVIF   | 50      | Short edge fits. Guarantees minimum width for grids. WebP for animated. |

**Fit strategies:**

- `inside` (default for max_dimension > 1024): The **long edge** fits within max_dimension. A 4000x3000 image at 2048px → 2048x1536. The image fits inside a square box. Good for "full size" variants where you want to cap the maximum dimension.
- `cover` (default for max_dimension ≤ 1024): The **short edge** fits within max_dimension, no cropping. A 4000x3000 image at 640px → 854x640. Guarantees the image is always at least `max_dimension` pixels wide (or tall for landscape), which is useful for grid layouts where cards have a fixed width.

**Variant skipping:** If the original image's long edge is already smaller than a variant's `max_dimension`, that variant is skipped. For example, uploading a 500x400 image will skip the `default` (2048px) variant entirely — only `thumbnail` (640px) is generated if the short edge (400px) is smaller than 640px. The `original` variant (compressed or raw) is always kept if `keep_original` is true.

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

| Metadata                    | Type   | Value                                 | Purpose                                                         |
| --------------------------- | ------ | ------------------------------------- | --------------------------------------------------------------- |
| `httpMetadata.contentType`  | HTTP   | e.g. `image/avif`                     | Browser renders correctly                                       |
| `httpMetadata.cacheControl` | HTTP   | `public, max-age=31536000, immutable` | Aggressive caching (variants are immutable, keyed by unique ID) |
| `customMetadata.width`      | Custom | e.g. `"2048"`                         | `<img width>` without DB lookup                                 |
| `customMetadata.height`     | Custom | e.g. `"1365"`                         | `<img height>` without DB lookup                                |

**Original file** (when `compress_original: true`, the default):

| Metadata                           | Type   | Value                                 | Purpose                        |
| ---------------------------------- | ------ | ------------------------------------- | ------------------------------ |
| `httpMetadata.contentType`         | HTTP   | `image/avif`                          | Re-encoded format              |
| `httpMetadata.cacheControl`        | HTTP   | `public, max-age=31536000, immutable` | Immutable (keyed by unique ID) |
| `customMetadata.width`             | Custom | e.g. `"4000"`                         | Full original dimensions       |
| `customMetadata.height`            | Custom | e.g. `"3000"`                         | Full original dimensions       |
| `customMetadata.original-filename` | Custom | e.g. `"vacation-photo.jpg"`           | Display name for downloads     |

**Original file** (when `compress_original: false`):

| Metadata                           | Type   | Value                       | Purpose                                                |
| ---------------------------------- | ------ | --------------------------- | ------------------------------------------------------ |
| `httpMetadata.contentType`         | HTTP   | From `File.type` at upload  | Best-guess MIME until processing detects the real type |
| `customMetadata.original-filename` | Custom | e.g. `"vacation-photo.jpg"` | Display name for downloads                             |

Rich metadata (colors, thumbhash, aspect ratio, animation info) belongs in the database record, not on R2 objects — it's used for UI rendering, not file serving.

### Animated Image Handling

When the input is animated:

- AVIF variants fall back to animated WebP (AVIF doesn't support animation in Sharp/libvips)
- Frame count is capped at 500 frames to prevent abuse
- The thumbhash uses only the first frame
- All frames are resized together, preserving timing/delays

### Transparency Handling

- If the input has transparency, AVIF and WebP variants preserve it
- JPEG variants (if requested) get a white background composited
- ThumbHash encodes the alpha channel

### Compressed Original

When `compress_original` is true (the default) and `keep_original` is true, the raw uploaded file at `{base_path}/original` is **replaced** after processing with a full-resolution AVIF re-encode. This preserves the original dimensions but significantly reduces file size:

| Scenario              | Raw Upload | Compressed Original | Savings |
| --------------------- | ---------- | ------------------- | ------- |
| 12MP JPEG from camera | 8 MB       | ~3 MB (AVIF q50)    | ~60%    |
| 48MP HEIC from iPhone | 12 MB      | ~5 MB (AVIF q50)    | ~58%    |
| 45MP RAW (NEF)        | 50 MB      | ~8 MB (AVIF q50)    | ~84%    |
| PNG screenshot        | 2 MB       | ~0.5 MB (AVIF q50)  | ~75%    |

Key behaviors:

- **EXIF and ICC metadata are preserved** in the compressed original (unlike resized variants which strip metadata). This is important for photographers who want to retain camera data, GPS coordinates, copyright info, etc.
- The compressed original uses the same quality/effort settings as the `default` variant (q50, effort 4) by default.
- When `compress_original` is false, the raw uploaded file is kept untouched. Useful when you need the exact original bytes (e.g. for print workflows or legal/archival purposes).
- For animated inputs, the compressed original is animated WebP (AVIF doesn't support animation).

### Variant Skipping

Variants are skipped when the original image is already smaller than the variant would produce. The skip logic uses the **long edge** of the original:

```
original long edge = max(original.width, original.height)

for each variant:
  if original_long_edge < variant.max_dimension:
    skip this variant
```

Examples:

- A 500x400 image (long edge: 500px) → skips `default` (2048px), generates `thumbnail` (640px) only if the fit logic would actually reduce the image
- A 1000x800 image (long edge: 1000px) → skips `default` (2048px), generates `thumbnail` (640px)
- A 4000x3000 image (long edge: 4000px) → generates both `default` (2048px) and `thumbnail` (640px)

The `original` variant is never skipped — it's always kept (compressed or raw) when `keep_original` is true.

### Avatar Profile

The `avatar: true` option enables face-aware square cropping, designed for user profile pictures. The crop happens **before** variant generation — all variants receive the already-cropped square image.

**Defaults when `avatar: true`:**

| Option              | Avatar Default                                                                                       | Normal Default      |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| `keep_original`     | `false`                                                                                              | `true`              |
| `compress_original` | n/a                                                                                                  | `true`              |
| `variants`          | `[{ name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4, fit: 'inside' }]` | default + thumbnail |

All defaults can be overridden explicitly. For example, `{ avatar: true, keep_original: true }` will keep the original (pre-crop) file.

**Cropping strategy:**

```
Input (any aspect ratio)
  │
  ├── 1. Run face detection (mediapipe-face-detection via @mediapipe/tasks-vision)
  │
  ├── 2a. Face detected:
  │   ├── Compute bounding box center of the largest face
  │   ├── Expand to a square crop region centered on the face
  │   │   (square side = min(width, height), shifted to keep face centered)
  │   ├── Clamp to image bounds
  │   └── Extract square region with Sharp .extract()
  │
  ├── 2b. No face detected:
  │   └── Fall back to Sharp's attention-based crop:
  │       sharp(input).resize(size, size, { fit: 'cover', position: 'attention' })
  │       (uses saliency/entropy to find the most interesting region)
  │
  ├── 3. Generate variant(s) from the cropped square
  │
  └── 4. Generate ThumbHash (from the cropped square — will encode 1:1 aspect ratio)
```

**Face detection details:**

- Uses `@mediapipe/tasks-vision` with the BlazeFace short-range model (~200 KB, optimized for faces within 2 meters of the camera)
- Runs on CPU in the Docker container — no GPU needed, ~50-100ms per image
- If multiple faces are detected, uses the largest bounding box (closest face)
- The model is loaded once at container startup and reused across requests

**Usage:**

```typescript
// Database integration
const avatar = await db.images.upload(file, { avatar: true });
// → One R2 file: images/{id}/thumbnail (640x640 square AVIF)
// → No original kept
// → ThumbHash encodes a 1:1 square

// Standalone
const result = await processImage(env.IMAGE_PROCESSOR, {
	bucket: env.MEDIA_BUCKET,
	key: 'uploads/selfie.jpg',
	avatar: true,
});
// → result.variants = [{ name: 'thumbnail', width: 640, height: 640, ... }]
```

The avatar variant uses `fit: 'inside'` (not `cover`) because the input is already square after cropping — both fit modes produce the same result on a square image.

---

## Metadata Extraction

All extracted metadata is returned in the `metadata` field. Here's everything Sharp + supplementary libraries can provide:

### Core Metadata (always available)

| Field                  | Source                         | Description                                          |
| ---------------------- | ------------------------------ | ---------------------------------------------------- |
| `file_name`            | Upload option                  | Original filename if provided, or null               |
| `file_extension`       | `file_name`                    | Lowercase extension without dot                      |
| `mime_type`            | `file-type` (magic bytes)      | True MIME type regardless of extension               |
| `file_size`            | R2 object info                 | Size in bytes                                        |
| `width`                | `sharp.metadata()`             | Pixels (after orientation correction)                |
| `height`               | `sharp.metadata()`             | Pixels (after orientation correction)                |
| `aspect_ratio`         | Computed                       | `width / height` as a float                          |
| `has_transparency`     | `sharp.metadata().hasAlpha`    | Whether alpha channel exists                         |
| `is_animated`          | `sharp.metadata().pages > 1`   | Whether image has multiple frames                    |
| `frame_count`          | `sharp.metadata().pages`       | Number of frames                                     |
| `color_space`          | `sharp.metadata().space`       | sRGB, CMYK, etc.                                     |
| `bit_depth`            | `sharp.metadata().depth`       | Bits per channel                                     |
| `channels`             | `sharp.metadata().channels`    | Number of channels                                   |
| `background_color`     | 1x1 resize + `culori`          | Average color as OKLCH `{ l, c, h }`                 |
| `background_color_css` | Computed                       | `oklch(0.65 0.04 210)` CSS string                    |
| `accent_color`         | `node-vibrant` + `culori`      | Vibrant color as OKLCH `{ l, c, h }`                 |
| `accent_color_css`     | Computed                       | `oklch(0.63 0.21 1)` CSS string                      |
| `luminance`            | `background_color.l`           | Average brightness (0-1), for text overlay decisions |
| `date_taken`           | EXIF `DateTimeOriginal`        | When the photo was taken (ISO 8601), or null         |
| `gps_latitude`         | EXIF GPS                       | Decimal degrees (positive = north), or null          |
| `gps_longitude`        | EXIF GPS                       | Decimal degrees (positive = east), or null           |
| `exif_orientation`     | `sharp.metadata().orientation` | EXIF orientation tag (1-8)                           |
| `has_icc_profile`      | `sharp.metadata().hasProfile`  | ICC profile presence                                 |
| `density`              | `sharp.metadata().density`     | DPI/PPI if available                                 |

### Color Extraction: Background + Accent

Two colors are extracted from each image, both in OKLCH:

**Background color** -- the average color of the image, suitable for use as a placeholder background or card color. Computed by resizing the image to 1x1 pixel (Sharp's lanczos3 kernel computes a weighted mean of all pixel colors):

```typescript
import { oklch, parse } from 'culori';

// Resize to 1x1 = true average of all pixels
const { data } = await sharp(input)
	.resize(1, 1)
	.raw()
	.toBuffer({ resolveWithObject: true });
const [r, g, b] = data;
const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const bg = oklch(parse(hex));
// bg = { l: 0.65, c: 0.04, h: 210 }
// CSS: oklch(0.65 0.04 210)
// luminance = bg.l (0.65 — use light text if < ~0.5)
```

**Accent color** -- the most visually prominent/saturated color that stands out. Computed via `node-vibrant`'s perceptual palette extraction, which uses Modified Median Cut Quantization to cluster colors and identify the "Vibrant" swatch:

```typescript
import { Vibrant } from 'node-vibrant/node';

const palette = await Vibrant.from(input).getPalette();
// Fallback chain: Vibrant > DarkVibrant > LightVibrant > Muted > null
const swatch =
	palette.Vibrant ?? palette.DarkVibrant ?? palette.LightVibrant ?? palette.Muted;

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

### Luminance

The `luminance` field is the `l` component of `background_color` — no extra computation needed. It represents the average perceived brightness of the entire image on a 0-1 scale. Primary use case: deciding text color for overlays.

```typescript
// Light text on dark images, dark text on light images
const textColor = image.luminance < 0.5 ? 'white' : 'black';
```

### EXIF: Date Taken & GPS

Date and GPS coordinates are extracted from EXIF metadata via `exif-reader` (which Sharp can invoke directly):

```typescript
import exifReader from 'exif-reader';

const { exif } = sharp.metadata();
const parsed = exif ? exifReader(exif) : null;

const date_taken = parsed?.exif?.DateTimeOriginal?.toISOString() ?? null;

const gps_latitude = parsed?.gps?.GPSLatitude
	? toDecimalDegrees(parsed.gps.GPSLatitude, parsed.gps.GPSLatitudeRef)
	: null;
const gps_longitude = parsed?.gps?.GPSLongitude
	? toDecimalDegrees(parsed.gps.GPSLongitude, parsed.gps.GPSLongitudeRef)
	: null;
```

These fields are null for images without EXIF data (screenshots, programmatically generated images, PNGs, most SVGs). GPS coordinates in particular are only present when the camera/phone had location services enabled.

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
			compress_original: true, // re-encode as full-res AVIF (default)
			// Override default variants or add custom ones
			// Variants larger than the source image are automatically skipped.
			variants: [
				{
					name: 'default',
					max_dimension: 2048,
					format: 'avif',
					quality: 50,
					effort: 4,
					fit: 'inside',
				},
				{
					name: 'thumbnail',
					max_dimension: 640,
					format: 'avif',
					quality: 50,
					effort: 4,
					fit: 'cover',
				},
				{
					name: 'social',
					max_dimension: 1200,
					format: 'jpeg',
					quality: 85,
					fit: 'inside',
				},
				{
					name: 'banner',
					max_dimension: 1920,
					format: 'webp',
					quality: 75,
					fit: 'inside',
				},
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

````typescript
interface ImageProcessingHelper {
	/**
	 * Save the original file to R2, create a pending image record,
	 * and schedule an alarm for processing.
	 *
	 * Accepts a File (auto-extracts file_name), ReadableStream, or ArrayBuffer.
	 *
	 * Generates a unique ID used for both the record and R2 keys:
	 *   {prefix}/{id}/original   ← compressed original (full-res AVIF) or raw upload
	 *   {prefix}/{id}/default    ← processed variant (after alarm, skipped if too large)
	 *   {prefix}/{id}/thumbnail  ← processed variant (after alarm, skipped if too large)
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
````

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
	readonly images = imageProcessing(this, {
		/* ... */
	});

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
4. For each: marks it `'processing'`, calls the Container DO via RPC (passing variant configs + `compress_original`)
5. The container skips variants whose `max_dimension` exceeds the original's long edge
6. The container applies the correct fit strategy (`inside` or `cover`) per variant
7. If `compress_original` is true, the container produces a full-res AVIF re-encode with metadata preserved
8. Back in the DO: writes variants to R2, replaces the raw original with the compressed version (if applicable)
9. On success: updates the record to `'processed'` with all metadata
10. On failure: updates the record to `'failed'` with an error code
11. If the image record was deleted during processing: cleans up variant files from R2
12. If more pending images remain, schedules another alarm (using "set only if earlier")

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
  luminance REAL,                      -- Average brightness (0-1), same as background_color_l
  date_taken TEXT,                     -- EXIF DateTimeOriginal as ISO 8601, or null
  gps_latitude REAL,                   -- Decimal degrees (positive = north), or null
  gps_longitude REAL,                  -- Decimal degrees (positive = east), or null
  thumbhash TEXT,                      -- ThumbHash base64 (~33 chars)
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
		compress_original: true, // re-encode original as full-res AVIF (default)
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

### SvelteKit CDN Hook

The package exports `createImageHandle()`, a factory that returns a SvelteKit `Handle` for serving images from R2 on your own domain.

**5. Add the CDN hook to your SvelteKit app:**

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createImageHandle } from '@delightstack/image-processor';

const imageHandle = createImageHandle({
	bucket: (event) => event.platform!.env.MEDIA_BUCKET,
});

export const handle = sequence(imageHandle /* , authHandle, ... */);
```

That's it. Images are now served at `/cdn/image/{id}/{variant}`:

- `/cdn/image/01JQ7X8K9M3N/default` — default variant
- `/cdn/image/01JQ7X8K9M3N/thumbnail` — thumbnail variant
- `/cdn/image/01JQ7X8K9M3N/original` — original file (with download filename)
- `/cdn/image/01JQ7X8K9M3N` — omit variant to get the default

**Options:**

```typescript
import type { RequestEvent } from '@sveltejs/kit';

interface CreateImageHandleOptions {
	/**
	 * Function to get the R2 bucket binding from the request event.
	 * Called on every image request.
	 */
	bucket: (event: RequestEvent) => R2Bucket;

	/**
	 * R2 key prefix. Must match the prefix used in imageProcessing() options.
	 * Default: 'images'
	 */
	prefix?: string;

	/**
	 * URL path prefix for image routes.
	 * Default: '/cdn/image'
	 */
	cdn_prefix?: string;

	/**
	 * Variant to serve when none is specified in the URL.
	 * Default: 'default'
	 */
	default_variant?: string;

	/**
	 * SVG string to serve as a 404 placeholder when an image doesn't exist.
	 * Served with Content-Type: image/svg+xml and Cache-Control: no-cache
	 * (so the browser retries after the image is processed).
	 * Default: built-in "Image not found" SVG
	 */
	placeholder?: string;
}
```

**Full example with all options:**

```typescript
const imageHandle = createImageHandle({
	bucket: (event) => event.platform!.env.MEDIA_BUCKET,
	prefix: 'images', // default
	cdn_prefix: '/cdn/image', // default
	default_variant: 'default', // default
	placeholder: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
		<rect width="400" height="300" fill="#f5f5f5"/>
		<text x="200" y="155" text-anchor="middle" fill="#aaa"
			font-family="system-ui,sans-serif" font-size="14">Not found</text>
	</svg>`,
});
```

**Implementation (inside the package):**

```typescript
import type { Handle, RequestEvent } from '@sveltejs/kit';

const DEFAULT_PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
	<rect width="400" height="300" fill="#f0f0f0"/>
	<text x="200" y="158" text-anchor="middle" fill="#999" font-family="system-ui,sans-serif" font-size="16">Image not found</text>
</svg>`;

export function createImageHandle(options: CreateImageHandleOptions): Handle {
	const prefix = options.prefix ?? 'images';
	const cdn_prefix = (options.cdn_prefix ?? '/cdn/image').replace(/\/$/, '') + '/';
	const default_variant = options.default_variant ?? 'default';
	const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;

	function notFound(): Response {
		return new Response(placeholder, {
			status: 404,
			headers: {
				'Content-Type': 'image/svg+xml',
				'Cache-Control': 'no-cache',
			},
		});
	}

	return async ({ event, resolve }) => {
		if (!event.url.pathname.startsWith(cdn_prefix)) {
			return resolve(event);
		}

		const path = event.url.pathname.slice(cdn_prefix.length);
		const segments = path.split('/').filter(Boolean);

		if (segments.length === 0) {
			return notFound();
		}

		const id = segments[0];
		const variant = segments[1] || default_variant;
		const key = `${prefix}/${id}/${variant}`;

		const bucket = options.bucket(event);

		// Conditional request: return 304 if the client already has this version
		const ifNoneMatch = event.request.headers.get('If-None-Match');
		if (ifNoneMatch) {
			const head = await bucket.head(key);
			if (head && ifNoneMatch === head.httpEtag) {
				return new Response(null, { status: 304 });
			}
		}

		const object = await bucket.get(key);

		if (!object) {
			return notFound();
		}

		const headers = new Headers();
		headers.set(
			'Content-Type',
			object.httpMetadata?.contentType ?? 'application/octet-stream',
		);
		headers.set(
			'Cache-Control',
			object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
		);
		headers.set('ETag', object.httpEtag);
		headers.set('X-Content-Type-Options', 'nosniff');

		// Expose dimensions as response headers (from R2 custom metadata)
		if (object.customMetadata?.width) {
			headers.set('X-Image-Width', object.customMetadata.width);
		}
		if (object.customMetadata?.height) {
			headers.set('X-Image-Height', object.customMetadata.height);
		}

		// For the original variant, set Content-Disposition so browsers
		// use the original filename when downloading
		if (variant === 'original' && object.customMetadata?.['original-filename']) {
			headers.set(
				'Content-Disposition',
				`inline; filename="${object.customMetadata['original-filename']}"`,
			);
		}

		return new Response(object.body, { headers });
	};
}
```

**Key behaviors:**

- **No database lookup.** Everything needed to serve the file lives on the R2 object itself (Content-Type, Cache-Control, dimensions). The CDN path is fast and independent of the database DO.
- **304 Not Modified.** Respects `If-None-Match` headers using the R2 object's ETag. After the first load, subsequent requests get a 304 with zero body transfer.
- **Immutable caching.** Processed variants are keyed by unique ID, so they never change. `max-age=31536000, immutable` tells browsers and CDNs to cache forever.
- **Placeholder 404.** Returns a customizable SVG placeholder instead of a broken image icon. Uses `Cache-Control: no-cache` so the browser retries once the image is processed.
- **Content-Disposition for originals.** When serving the `original` variant, sets the original filename so "Save Image As" uses the right name.
- **Composable.** Returns a standard SvelteKit `Handle` — use with `sequence()` alongside auth hooks, logging, etc.

**Usage in Svelte templates:**

```svelte
<!-- Basic usage -->
<img src="/cdn/image/{image.id}/default" alt="" />

<!-- Thumbnail -->
<img src="/cdn/image/{image.id}/thumbnail" alt="" />

<!-- Omit variant for default -->
<img src="/cdn/image/{image.id}" alt="" />

<!-- With dimensions from the image record (avoids layout shift) -->
<img
	src="/cdn/image/{image.id}/default"
	width={image.width}
	height={image.height}
	alt="" />
```

---

## Svelte Image Component

A Svelte 5 component for displaying images from the image processor. Handles thumbhash placeholders, responsive srcset, progressive loading, and error recovery.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `image` | `ImageRecord` | (required) | Image record from the database. |
| `alt` | `string` | `undefined` | Alt text. Falls back to `image.file_name` without extension (e.g. `"vacation-photo"`). |
| `fit` | `'cover' \| 'contain' \| 'fill' \| 'none' \| 'scale-down'` | `'cover'` | CSS `object-fit` value. |
| `loading` | `'lazy' \| 'eager'` | `'lazy'` | Browser loading strategy. |
| `ssr_placeholder` | `boolean` | `false` | Decode thumbhash on the server during SSR. Use for above-the-fold hero images. |
| `sizes` | `string` | `'100vw'` | Responsive `sizes` attribute for srcset. Tells the browser how wide the image slot is. |
| `cdn_prefix` | `string` | `'/cdn/image'` | URL prefix for the CDN hook. |
| `onload` | `() => void` | `undefined` | Called when the full image loads. |
| `class` | `string` | `''` | CSS class for the container. |
| `style` | `string` | `''` | Inline style for the container. |

### Loading Behavior

The component uses three-tier progressive loading:

```
1. Background color (immediate, from HTML — no JS needed)
   └── image.background_color as oklch() CSS value
   └── Prevents white flash, matches the image's average color

2. ThumbHash placeholder (SSR or after JS loads)
   └── ssr_placeholder: true → decoded on server, in initial HTML (no flash)
   └── ssr_placeholder: false → decoded on client after JS loads (~32x32 blurred preview)

3. Full image (after browser fetches the best srcset variant)
   └── Smooth 300ms opacity fade from placeholder to loaded image
   └── Cached images skip the fade (detected via img.complete)
```

For a **hero image** above the fold, use `ssr_placeholder` + `loading="eager"` to eliminate any flash:

```svelte
<Image image={hero} alt="Welcome" ssr_placeholder loading="eager" />
```

For an **image grid**, use the defaults — the background color shows instantly, the thumbhash appears after JS hydrates, and the full image lazy-loads on scroll:

```svelte
{#each photos as photo}
	<Image image={photo} alt={photo.file_name ?? ''} sizes="(max-width: 768px) 50vw, 33vw" />
{/each}
```

### Exported Helpers

```typescript
/**
 * Decode a base64 thumbhash to a data:image/png URL.
 * Works server-side (pure JS, no canvas).
 * Use this outside the component — e.g. in a load function or API response.
 */
export function decodeThumbHash(base64: string): string;

/**
 * Build a CDN URL for an image variant.
 * Useful for links, downloads, or Open Graph meta tags.
 */
export function imageURL(
	image_id: string,
	variant?: string,   // Default: 'default'
	cdn_prefix?: string, // Default: '/cdn/image'
): string;
// imageURL('01JQ7X8K9M3N') → '/cdn/image/01JQ7X8K9M3N/default'
// imageURL('01JQ7X8K9M3N', 'thumbnail') → '/cdn/image/01JQ7X8K9M3N/thumbnail'
// imageURL('01JQ7X8K9M3N', 'original') → '/cdn/image/01JQ7X8K9M3N/original'
```

### Component Source

```svelte
<script lang="ts" module>
	import { thumbHashToDataURL } from 'thumbhash';

	/** Decode a base64 thumbhash to a data:image/png URL. Works server-side (pure JS). */
	export function decodeThumbHash(base64: string): string {
		const binary = atob(base64);
		const hash = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			hash[i] = binary.charCodeAt(i);
		}
		return thumbHashToDataURL(hash);
	}

	/** Build a CDN URL for an image variant. */
	export function imageURL(
		image_id: string,
		variant = 'default',
		cdn_prefix = '/cdn/image',
	): string {
		return `${cdn_prefix}/${image_id}/${variant}`;
	}
</script>

<script lang="ts">
	const is_browser = typeof window !== 'undefined';

	interface Props {
		image: {
			id: string;
			processing_status: string;
			file_name: string | null;
			width: number | null;
			height: number | null;
			aspect_ratio: number | null;
			thumbhash: string | null;
			background_color_l: number | null;
			background_color_c: number | null;
			background_color_h: number | null;
			variants: { name: string; width: number; height: number }[] | string | null;
		};
		alt?: string;
		fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
		loading?: 'lazy' | 'eager';
		ssr_placeholder?: boolean;
		sizes?: string;
		cdn_prefix?: string;
		onload?: () => void;
		class?: string;
		style?: string;
	}

	let {
		image,
		alt,
		fit = 'cover',
		loading = 'lazy',
		ssr_placeholder = false,
		sizes = '100vw',
		cdn_prefix = '/cdn/image',
		onload,
		class: className = '',
		style = '',
	}: Props = $props();

	// Alt text: explicit prop → file_name without extension → empty string
	const alt_text = $derived(
		alt ?? image.file_name?.replace(/\.[^.]+$/, '') ?? '',
	);

	// Parse variants from JSON string or use directly
	const variants = $derived(
		!image.variants
			? []
			: typeof image.variants === 'string'
				? JSON.parse(image.variants)
				: image.variants,
	);

	// srcset: all non-original variants, ascending by width
	const srcset = $derived(
		variants
			.filter((v: { name: string }) => v.name !== 'original')
			.sort((a: { width: number }, b: { width: number }) => a.width - b.width)
			.map(
				(v: { name: string; width: number }) =>
					`${cdn_prefix}/${image.id}/${v.name} ${v.width}w`,
			)
			.join(', '),
	);

	// Fallback src: largest non-original variant
	const src = $derived.by(() => {
		const best = variants
			.filter((v: { name: string }) => v.name !== 'original')
			.sort((a: { width: number }, b: { width: number }) => b.width - a.width)[0];
		return `${cdn_prefix}/${image.id}/${best?.name ?? 'default'}`;
	});

	// Background color for immediate placeholder (CSS only, no JS needed)
	const bg_color = $derived(
		image.background_color_l != null
			? `oklch(${image.background_color_l} ${image.background_color_c} ${image.background_color_h})`
			: undefined,
	);

	// ThumbHash placeholder:
	// ssr_placeholder=true  → decoded on server + client (in the initial HTML)
	// ssr_placeholder=false → decoded on client only (after JS hydrates)
	const placeholder = $derived.by(() => {
		if (!image.thumbhash) return null;
		if (!ssr_placeholder && !is_browser) return null;
		return decodeThumbHash(image.thumbhash);
	});

	let img_el = $state<HTMLImageElement>();
	let loaded = $state(false);
	let instant = $state(false);
	let error_count = $state(0);
	let retry_timer: ReturnType<typeof setTimeout>;

	// Detect cached images — skip the fade transition
	$effect(() => {
		if (img_el?.complete && img_el.naturalWidth > 0) {
			loaded = true;
			instant = true;
		}
	});

	function handleLoad() {
		loaded = true;
		onload?.();
	}

	function handleError() {
		if (error_count >= 3) return;
		error_count++;
		clearTimeout(retry_timer);
		retry_timer = setTimeout(() => {
			if (loaded || !img_el) return;
			const current = img_el.src;
			img_el.src = '';
			img_el.src = current;
		}, error_count ** 2 * 1000); // 1s, 4s, 9s
	}

	$effect(() => () => clearTimeout(retry_timer));

	const is_ready = $derived(image.processing_status === 'processed');
</script>

<div
	class="image {className}"
	style:background-color={bg_color}
	style:aspect-ratio={image.aspect_ratio ?? undefined}
	{style}>
	{#if placeholder && !loaded}
		<img
			class="placeholder"
			src={placeholder}
			alt=""
			aria-hidden="true"
			style:object-fit={fit} />
	{/if}
	{#if is_ready}
		<img
			bind:this={img_el}
			class="main"
			class:loaded
			class:instant
			{src}
			srcset={srcset || undefined}
			{sizes}
			alt={alt_text}
			width={image.width ?? undefined}
			height={image.height ?? undefined}
			{loading}
			style:object-fit={fit}
			onload={handleLoad}
			onerror={handleError} />
	{/if}
</div>

<style>
	.image {
		position: relative;
		overflow: hidden;
	}

	.placeholder {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		filter: blur(20px);
		transform: scale(1.1); /* hide blurred edges */
		z-index: 1;
		pointer-events: none;
	}

	.main {
		display: block;
		width: 100%;
		height: 100%;
		position: relative;
		z-index: 2;
		opacity: 0;
		transition: opacity 300ms ease;
	}

	.loaded {
		opacity: 1;
	}

	/* Skip transition for cached images */
	.instant {
		transition: none;
	}
</style>
```

### Usage Examples

**Basic — alt text derived from file_name automatically:**

```svelte
<Image image={photo} />
<!-- alt="vacation-photo" (from file_name "vacation-photo.jpg") -->
```

**Explicit alt text:**

```svelte
<Image image={photo} alt="A sunset over the ocean" />
```

**Hero image — SSR placeholder, eager load, no flash:**

```svelte
<Image image={hero} alt="Welcome to our site" ssr_placeholder loading="eager" />
```

**Responsive grid — tell the browser each image is ~33% of viewport:**

```svelte
<div class="grid">
	{#each photos as photo}
		<Image image={photo} sizes="(max-width: 768px) 50vw, 33vw" />
	{/each}
</div>
```

**Avatar — square, cover fit:**

```svelte
<div class="avatar" style="width: 48px; height: 48px; border-radius: 50%; overflow: hidden;">
	<Image image={user.avatar} alt={user.name} />
</div>
```

**Contain fit — diagrams, screenshots:**

```svelte
<Image image={diagram} alt="Architecture diagram" fit="contain" />
```

**With onload callback:**

```svelte
<Image image={photo} onload={() => console.log('Image loaded!')} />
```

**Building URLs outside the component:**

```svelte
<script>
	import { imageURL, decodeThumbHash } from '@delightstack/image-processor';
</script>

<!-- Open Graph meta tag -->
<svelte:head>
	<meta property="og:image" content={imageURL(image.id, 'default')} />
</svelte:head>

<!-- Download link -->
<a href={imageURL(image.id, 'original')} download>Download original</a>

<!-- Server-side placeholder in a +page.server.ts load function -->
<!-- const placeholder_url = decodeThumbHash(image.thumbhash); -->
```

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

| Factor                      | Bun + Sharp                                                                               | Rust                                            | Go                               | Python                         |
| --------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------- | ------------------------------ |
| **Processing engine**       | libvips (via Sharp)                                                                       | image-rs or libvips FFI                         | bimg (libvips)                   | Pillow or pyvips               |
| **Format breadth**          | Excellent (all via libvips)                                                               | Limited (no HEIC, no PDF, no RAW without C FFI) | Same as Sharp (both use libvips) | Good (via Pillow plugins)      |
| **Performance**             | Excellent (C-level via libvips, fast startup via Bun)                                     | Excellent (native)                              | Excellent (C-level via libvips)  | Slower (GIL + Python overhead) |
| **Memory efficiency**       | Excellent (libvips streaming)                                                             | Good                                            | Excellent (libvips streaming)    | Poor (Pillow loads full image) |
| **Ecosystem for this task** | Best (sharp, file-type, culori, thumbhash, node-vibrant, @mediapipe/tasks-vision all npm) | Fragmented                                      | Decent                           | Rich but slow                  |
| **Docker image size**       | ~300 MB                                                                                   | ~200 MB                                         | ~250 MB                          | ~400 MB                        |
| **Developer familiarity**   | Matches rest of Delightstack (TypeScript)                                                 | Different language                              | Different language               | Different language             |
| **Community/maintenance**   | Sharp: 29K stars, very active                                                             | image-rs: 5K stars                              | bimg: 4K stars                   | Pillow: 12K stars              |

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
│   ├── face-crop.ts           # Face detection + square crop for avatar profile
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
│   ├── Image.svelte            # Svelte 5 image component
│   ├── image-helpers.ts        # decodeThumbHash(), imageURL()
│   ├── types.ts                # All TypeScript types
│   └── errors.ts               # Error classes
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
// thumbHashToDataURL(result.thumbhash) → "data:image/png;base64,..." (works server-side)
// result.metadata.background_color_css → "oklch(0.65 0.04 210)"
// result.metadata.accent_color_css → "oklch(0.63 0.21 1)"
// result.variants[0].key → "images/01JQ7X8K9M3N/default"
```

You give it a bucket and a key. It gives you back everything you need to display that image beautifully on a website, including a thumbhash placeholder (server-renderable via `thumbHashToDataURL()`), optimized variants, and rich metadata. No webhooks. No polling. No configuration beyond the basics. With the database integration, the user doesn't even wait -- upload returns immediately and processing happens in the background.
