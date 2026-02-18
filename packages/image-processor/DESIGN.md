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

```
                    Cloudflare Edge
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Your Worker                                       │
│   ┌───────────────────────────────┐                 │
│   │  import { processImage }      │                 │
│   │  from '@delightstack/         │                 │
│   │        image-processor'       │                 │
│   │                               │                 │
│   │  const result = await         │                 │
│   │    processImage(env, {        │                 │
│   │      bucket: 'my-bucket',     │                 │
│   │      key: 'uploads/photo.jpg' │                 │
│   │    })                         │ ── RPC ──────►  │
│   └───────────────────────────────┘                 │
│                                                     │
│   ImageProcessor (Durable Object + Container)       │
│   ┌─────────────────────────────────────────────┐   │
│   │  Container class (manages lifecycle)        │   │
│   │  ┌───────────────────────────────────────┐  │   │
│   │  │  Docker Container (Bun + Sharp)        │  │   │
│   │  │                                       │  │   │
│   │  │  1. Download from R2/S3               │  │   │
│   │  │  2. Validate & extract metadata       │  │   │
│   │  │  3. Generate variants (avif, thumb)   │  │   │
│   │  │  4. Generate thumbhash + base64 tiny  │  │   │
│   │  │  5. Upload results back to R2/S3      │  │   │
│   │  │  6. Return metadata + variant info    │  │   │
│   │  └───────────────────────────────────────┘  │   │
│   └─────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The package exports two things:

1. **A Container/Durable Object class** (`ImageProcessorContainer`) that you add to your wrangler config and export from your worker entrypoint.
2. **A helper function** (`processImage`) that your worker code calls. It uses Cloudflare Workers RPC to call a method directly on the Durable Object -- no HTTP request construction or response parsing needed.

The container sleeps when idle (scale-to-zero). Cold starts take ~2-3 seconds. The `processImage()` call awaits the result synchronously via RPC -- Workers have no wall-clock time limit, so waiting 2-30 seconds for processing is fine. No webhooks, no polling, no queues.

---

## How It Works

### The Simplest Possible Setup

**1. Install the package:**

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

**3. Export the container class and use it:**

```typescript
// src/index.ts
import { ImageProcessorContainer, processImage } from '@delightstack/image-processor';

// Re-export the container class so Cloudflare discovers it
export { ImageProcessorContainer };

export default {
	async fetch(request: Request, env: Env) {
		// Process an image that was uploaded to R2
		const result = await processImage(env.IMAGE_PROCESSOR, {
			bucket: env.MEDIA_BUCKET,
			key: 'uploads/user-123/photo.jpg',
			keep_original: true,
			output_prefix: 'processed/user-123/',
		});

		// result contains all metadata + variant URLs
		return Response.json(result);
	},
};
```

That's it. Three files touched. No webhook endpoints, no queue consumers, no polling.

### How the Synchronous Call Works

The `processImage()` helper uses Cloudflare Workers RPC to call a method directly on the Durable Object. Since the `Container` class extends `DurableObject`, any public method on it is automatically exposed as an RPC endpoint. No HTTP request construction, URL routing, or response parsing needed -- it's a direct async method call.

```typescript
async function processImage(
	binding: DurableObjectNamespace<ImageProcessorContainer>,
	options: ProcessImageOptions,
): Promise<ProcessImageResult> {
	// Get a container instance (reuses running containers)
	const stub = binding.getByName('image-processor');

	// Direct RPC method call on the Durable Object:
	// 1. Wakes the container if sleeping (~2-3s cold start)
	// 2. Reads input from R2 and streams to container
	// 3. Waits for the container to finish (2-30s)
	// 4. Writes output variants to R2
	// 5. Returns the typed result directly
	//
	// Workers have NO wall-clock time limit.
	// The await is I/O wait, NOT CPU time. The CPU cost is negligible.
	return await stub.process(options);
}
```

The Container class exposes the `process` RPC method and handles the full lifecycle:

```typescript
import { Container } from '@cloudflare/containers';

class ImageProcessorContainer extends Container {
	defaultPort = 8080;
	sleepAfter = '5m';
	enableInternet = false; // No outbound internet needed

	// Public method = automatically exposed as RPC endpoint
	async process(options: ProcessImageOptions): Promise<ProcessImageResult> {
		// 1. Read input from R2 via this.env.MEDIA_BUCKET
		const input = await this.env[options.bucket_binding].get(options.key);

		// 2. Stream input to the container for processing
		const port = this.ctx.container.getTcpPort(8080);
		const response = await port.fetch('http://localhost/process', {
			method: 'POST',
			body: input.body,
			headers: { 'X-Options': btoa(JSON.stringify(options)) },
		});

		// 3. Parse multipart response (metadata + variant binaries)
		const { metadata, variants } = await parseMultipartResponse(response);

		// 4. Write variants to R2
		for (const variant of variants) {
			await this.env[options.bucket_binding].put(variant.key, variant.data);
		}

		// 5. Return typed result (serialized via Structured Clone over RPC)
		return { ok: true, job_id: crypto.randomUUID(), metadata, variants, ... };
	}
}
```

Key RPC details:
- **No URL routing**: Calling `stub.process(options)` invokes the method directly -- no `fetch()`, no URL construction, no JSON serialization/deserialization.
- **Structured Clone serialization**: RPC uses Structured Clone (not JSON), so `Date`, `ArrayBuffer`, `Map`, `Set`, and typed arrays all work natively. Max payload is 32 MiB; use `ReadableStream` for larger data.
- **Type safety**: The `DurableObjectNamespace<ImageProcessorContainer>` generic gives full TypeScript autocomplete on the stub.
- **R2 bindings stay server-side**: R2 buckets can't be passed over RPC, so the DO accesses them via `this.env` -- which is why the DO handles all R2 I/O.

### R2 Access Pattern

The container itself does not have direct access to R2 bindings (containers are Docker VMs, not Workers). The Durable Object handles all storage I/O:

1. The DO reads the input file from R2 and streams it to the container via HTTP.
2. The container processes the image and returns all outputs (variant binaries + metadata) in a multipart response.
3. The DO writes each variant back to R2.

This keeps `enableInternet = false` on the container (more secure), keeps the container fully stateless, and centralizes all storage logic in the DO where it has access to the R2 binding via `this.env`.

```
Worker                    DO                          Container
  │                       │                              │
  │── stub.process() ──►  │                              │
  │   (RPC call)          │── read input from R2         │
  │                       │── stream to container ──►    │
  │                       │                              │── process
  │                       │                              │── resize
  │                       │                              │── extract metadata
  │                       │  ◄── multipart response ──── │
  │                       │── write variants to R2       │
  │  ◄── result ────────  │                              │
  │   (RPC return)        │                              │
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

	/** Prefix for output files. Default: same directory as input */
	output_prefix?: string;

	/**
	 * Custom variant configuration. If omitted, uses these defaults:
	 * - { name: 'standard', max_dimension: 2048, format: 'avif', quality: 50, effort: 4 }
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
	/** Original filename with extension */
	file_name: string;

	/** File extension (lowercase, without dot) */
	file_extension: string;

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
	/** Variant name (e.g. 'standard', 'thumbnail', 'original') */
	name: string;

	/** R2 key where the variant was saved */
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
  │   ├── "standard" → 2048px long-edge, AVIF q50 effort 4, strip metadata
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
  │   ├── "standard" → 2048px, animated WebP (AVIF doesn't support animation)
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
| `standard`  | 2048px        | AVIF                       | 50      | Primary viewing size. WebP for animated. |
| `thumbnail` | 640px         | AVIF                       | 50      | List/grid views. WebP for animated.      |
| `tiny`      | 36px          | smallest of AVIF/WebP/JPEG | 40      | Base64-encoded data URI                  |

### Output File Naming

```
{output_prefix}{original_name_without_ext}/{variant_name}.{format}

Example:
  Input:  uploads/user-123/photo.jpg
  Output: processed/user-123/photo/standard.avif
          processed/user-123/photo/thumbnail.avif
```

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
| `file_name`          | Input key                      | Original filename with extension       |
| `file_extension`     | Input key                      | Lowercase extension without dot        |
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
				{ name: 'standard', max_dimension: 2048, format: 'avif', quality: 50, effort: 4 },
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
- Part 2: standard.avif binary
- Part 3: thumbnail.avif binary
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

For S3-compatible buckets other than R2, pass credentials:

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

When using R2 (the default), no credentials are needed -- the R2 bucket binding handles auth natively.

### Scaling Considerations

**Single Container (default):**

- One container instance handles all requests sequentially
- Good for low-to-moderate traffic (up to ~100-200 images/hour depending on size)
- Images queue up while the container is processing

**Multiple Containers:**

- Set `max_instances` higher in wrangler.toml
- Use different DO IDs to route to different container instances
- The helper function can auto-distribute using a round-robin or hash-based strategy

```typescript
// Simple round-robin across N containers
const result = await processImage(env.IMAGE_PROCESSOR, {
	// Automatically picks a container instance
	container_strategy: 'round-robin',
	max_containers: 5,
	// ... other options
});
```

**Scale-to-zero:** Containers automatically sleep after the configured `sleepAfter` period (default 5 minutes). Billing stops during sleep. Cold start on next request is ~2-3 seconds.

---

## Delightstack Integration

### Database Schema Helper

The package provides a pre-built database schema for storing image metadata in a `@delightstack/database` table:

```typescript
import { defineImageTable } from '@delightstack/image-processor/schema';

// Use in your database config
const database = {
	image: defineImageTable(),
	// ... your other tables
};
```

This creates a table with columns matching the `ProcessImageResult` structure:

```sql
CREATE TABLE image (
  id TEXT PRIMARY KEY,                  -- Timestamp-based ID
  key TEXT NOT NULL,                    -- R2 key of the input file
  file_name TEXT NOT NULL,              -- Original filename
  mime_type TEXT NOT NULL,              -- Detected MIME type
  file_size INTEGER NOT NULL,           -- Original file size in bytes
  width INTEGER NOT NULL,               -- Original width (orientation-corrected)
  height INTEGER NOT NULL,              -- Original height (orientation-corrected)
  aspect_ratio REAL NOT NULL,           -- width/height float
  has_transparency INTEGER NOT NULL,    -- 0 or 1
  is_animated INTEGER NOT NULL,         -- 0 or 1
  frame_count INTEGER NOT NULL,         -- Number of frames
  background_color_l REAL,              -- Background OKLCH lightness
  background_color_c REAL,              -- Background OKLCH chroma
  background_color_h REAL,              -- Background OKLCH hue
  accent_color_l REAL,                  -- Accent OKLCH lightness (nullable)
  accent_color_c REAL,                  -- Accent OKLCH chroma (nullable)
  accent_color_h REAL,                  -- Accent OKLCH hue (nullable)
  thumbhash TEXT NOT NULL,              -- ThumbHash base64
  tiny_preview TEXT NOT NULL,           -- Base64 data URI
  variants TEXT NOT NULL,               -- JSON array of variant info (includes 'original' if kept)
  processing_status TEXT NOT NULL,      -- 'pending' | 'processing' | 'completed' | 'failed'
  error_code TEXT,                      -- Error code if failed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Full Integration Example

```typescript
import { ImageProcessorContainer, processImage } from '@delightstack/image-processor';
import { DatabaseServer } from '@delightstack/database';
import { defineImageTable } from '@delightstack/image-processor/schema';

export { ImageProcessorContainer };

// Your database config includes the image table
const dbConfig = {
	image: defineImageTable(),
	user: defineUserTable(),
};

export class AppDatabase extends DatabaseServer<typeof dbConfig> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(dbConfig, () => null, ctx, env);
	}

	/** Process an uploaded image and save the result to the database */
	async processAndSaveImage(
		imageProcessorBinding: DurableObjectNamespace,
		bucket: R2Bucket,
		key: string,
	) {
		// Process the image
		const result = await processImage(imageProcessorBinding, {
			bucket,
			key,
			keep_original: true,
			output_prefix: 'processed/',
		});

		// Save to database (all metadata + variant info)
		return this.create('image', {
			key,
			file_name: result.metadata.file_name,
			mime_type: result.metadata.mime_type,
			file_size: result.metadata.file_size,
			width: result.metadata.width,
			height: result.metadata.height,
			aspect_ratio: result.metadata.aspect_ratio,
			has_transparency: result.metadata.has_transparency,
			is_animated: result.metadata.is_animated,
			frame_count: result.metadata.frame_count,
			background_color_l: result.metadata.background_color.l,
			background_color_c: result.metadata.background_color.c,
			background_color_h: result.metadata.background_color.h,
			accent_color_l: result.metadata.accent_color?.l ?? null,
			accent_color_c: result.metadata.accent_color?.c ?? null,
			accent_color_h: result.metadata.accent_color?.h ?? null,
			thumbhash: result.thumbhash,
			tiny_preview: result.tiny_preview,
			variants: result.variants,
			processing_status: 'completed',
		});
	}
}
```

### Avoiding Webhooks: The Direct-Call Pattern

The key insight for Delightstack integration: **you never need webhooks**. Because the `processImage()` call is synchronous (from the Worker's perspective), you can process an image and save the result to the database in a single request handler:

```typescript
// In your Worker fetch handler
async function handleUpload(request: Request, env: Env) {
	const formData = await request.formData();
	const file = formData.get('file') as File;

	// 1. Upload raw file to R2
	const key = `uploads/${crypto.randomUUID()}/${file.name}`;
	await env.MEDIA_BUCKET.put(key, file.stream());

	// 2. Process it (synchronous -- waits for container to finish)
	const result = await processImage(env.IMAGE_PROCESSOR, {
		bucket: env.MEDIA_BUCKET,
		key,
	});

	// 3. Save metadata to database (RPC call to your database DO)
	const db = env.APP_DATABASE.getByName('main');
	const image = await db.createImage({
		key,
		...result.metadata,
		thumbhash: result.thumbhash,
		tiny_preview: result.tiny_preview,
		variants: result.variants,
	});

	// 4. Return to client
	return Response.json({ ok: true, image });
}
```

The user uploads an image, and in a single HTTP request-response cycle: the file goes to R2, gets processed by the container, metadata is saved to the database, and the client gets the full result back. No background jobs, no polling, no webhooks.

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

### 2. Async/Batch Processing

Should we support a fire-and-forget mode for large batch uploads?

The synchronous pattern works great for single image uploads. But for batch processing (e.g., uploading 50 images at once), you'd want to queue them and get results later. Options:

- Use `Promise.all` with multiple `processImage` calls (container processes sequentially)
- Use Cloudflare Queues for batching
- Use Cloudflare Workflows for complex multi-step pipelines

Recommendation: Start synchronous-only. Add queue-based batch processing as a later feature.

### 3. Image Optimization Profiles

Should we provide named profiles for common use cases?

```typescript
// E-commerce product images
processImage(env.IMAGE_PROCESSOR, {
  profile: 'ecommerce',  // 2048 standard + 640 thumb + 120 tiny + white bg
  ...
});

// User avatars
processImage(env.IMAGE_PROCESSOR, {
  profile: 'avatar',  // 512 standard + 128 thumb + square crop
  ...
});

// Blog/CMS content images
processImage(env.IMAGE_PROCESSOR, {
  profile: 'content',  // 1920 standard + 640 thumb + social share variant
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
│   ├── process.ts             # processImage() helper function
│   ├── types.ts               # All TypeScript types
│   ├── errors.ts              # Error classes
│   └── schema.ts              # Database schema helper for @delightstack/database
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
const result = await processImage(env.IMAGE_PROCESSOR, {
	bucket: env.MEDIA_BUCKET,
	key: 'uploads/photo.jpg',
});

// result.thumbhash → "3OcRJYB4d3h/iIeHeEh3eIhw+j2w"
// result.tiny_preview → "data:image/avif;base64,AAAAIG..."
// result.metadata.background_color_css → "oklch(0.65 0.04 210)"
// result.metadata.accent_color_css → "oklch(0.63 0.21 1)"
// result.variants[0].key → "processed/photo/standard.avif"
// result.variants[1].key → "processed/photo/thumbnail.avif"
// result.variants[2].name → "original" (if keep_original is true)
```

You give it a bucket and a key. It gives you back everything you need to display that image beautifully on a website, including instant placeholder previews, optimized variants, and rich metadata. No webhooks. No background jobs. No configuration beyond the basics.
