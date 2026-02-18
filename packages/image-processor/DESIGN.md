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
│   │    })                         │ ── fetch() ──►  │
│   └───────────────────────────────┘                 │
│                                                     │
│   ImageProcessor (Durable Object + Container)       │
│   ┌─────────────────────────────────────────────┐   │
│   │  Container class (manages lifecycle)        │   │
│   │  ┌───────────────────────────────────────┐  │   │
│   │  │  Docker Container (Node.js + Sharp)   │  │   │
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
2. **A helper function** (`processImage`) that your worker code calls. It handles the Durable Object binding, sends the request, and returns a typed result.

The container sleeps when idle (scale-to-zero). Cold starts take ~2-3 seconds. The `processImage()` call awaits the container's HTTP response synchronously -- Workers have no wall-clock time limit on HTTP-triggered requests, so waiting 2-30 seconds for processing is fine. No webhooks, no polling, no queues.

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

The `processImage()` helper does this internally:

```typescript
async function processImage(
	binding: DurableObjectNamespace,
	options: ProcessImageOptions,
): Promise<ProcessImageResult> {
	// Get a container instance (reuses running containers)
	const id = binding.idFromName('image-processor');
	const stub = binding.get(id);

	// This single fetch call:
	// 1. Wakes the container if sleeping (~2-3s cold start)
	// 2. Sends the processing request
	// 3. Waits for the container to finish (2-30s)
	// 4. Returns the result
	//
	// Workers have NO wall-clock time limit on HTTP requests.
	// The await is I/O wait, NOT CPU time. The CPU cost is negligible.
	const response = await stub.fetch('https://image-processor/process', {
		method: 'POST',
		body: JSON.stringify(options),
		headers: { 'Content-Type': 'application/json' },
	});

	if (!response.ok) {
		const error = await response.json();
		throw new ImageProcessorError(error);
	}

	return response.json();
}
```

The Container class handles the lifecycle:

```typescript
class ImageProcessorContainer extends Container {
	defaultPort = 8080;
	sleepAfter = '5m'; // Sleep after 5 minutes of idle
	enableInternet = false; // No outbound internet needed

	// The container downloads from R2/S3 via a presigned URL
	// or via the R2 binding passed through the DO
}
```

### R2 Access Pattern

The container itself does not have direct access to R2 bindings (containers are Docker VMs, not Workers). Instead, the Durable Object acts as a proxy:

**Option A: Presigned URLs (preferred for large files)**
The DO generates presigned R2 URLs and passes them to the container. The container downloads/uploads using standard HTTP. Requires `enableInternet = true` for R2 presigned URLs, OR the DO can proxy the data.

**Option B: DO-proxied data**
The DO reads the file from R2 and streams it to the container in the request body. The container processes it and returns the results in the response, which the DO writes back to R2. This avoids needing internet access but means the DO handles all data transfer.

**Option C: Hybrid (recommended)**
The DO reads the input from R2 and streams it to the container. The container processes it, and returns all outputs (variants + metadata) in a multipart response. The DO then writes the variants back to R2. This keeps `enableInternet = false` (more secure), keeps the container stateless, and lets the DO handle storage concerns.

```
Worker                    DO                          Container
  │                       │                              │
  │── processImage() ──►  │                              │
  │                       │── read input from R2 ──►     │
  │                       │── stream to container ──►    │
  │                       │                              │── process
  │                       │                              │── resize
  │                       │                              │── extract metadata
  │                       │  ◄── multipart response ──── │
  │                       │── write variants to R2 ──►   │
  │  ◄── result JSON ──── │                              │
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

	/** Custom variant configuration. Uses sensible defaults if omitted */
	variants?: VariantConfig[];

	/** Custom processing options */
	processing?: {
		/** AVIF quality for the standard variant (1-100). Default: 50 */
		avif_quality?: number;

		/** AVIF encoding effort (0-9, higher = slower + smaller). Default: 4 */
		avif_effort?: number;

		/** Thumbnail long-edge size in pixels. Default: 640 */
		thumbnail_size?: number;

		/** Standard variant long-edge size in pixels. Default: 2048 */
		standard_size?: number;

		/** Size of the tiny base64 preview. Default: 36 */
		tiny_preview_size?: number;
	};
}

interface VariantConfig {
	/** Unique name for this variant (used in output key) */
	name: string;

	/** Maximum long-edge dimension in pixels */
	max_dimension: number;

	/** Output format */
	format: 'avif' | 'webp' | 'jpeg' | 'png';

	/** Quality (1-100) */
	quality?: number;
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

	/** The generated output variants */
	variants: OutputVariant[];

	/** Info about the original file */
	original: {
		/** R2 key of the original file (undefined if deleted) */
		key?: string;
		/** Whether the original was kept */
		kept: boolean;
	};
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

	/** Dominant color in OKLCH format { l: 0-1, c: 0-0.4, h: 0-360 } */
	dominant_color: { l: number; c: number; h: number };

	/** Dominant color as a CSS oklch() string */
	dominant_color_css: string;

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
	/** Variant name (e.g. 'standard', 'thumbnail') */
	name: string;

	/** R2 key where the variant was saved */
	key: string;

	/** Output format */
	format: 'avif' | 'webp' | 'jpeg' | 'png';

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
  ├── 5. Compute dominant color → OKLCH via culori
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
| `dominant_color`     | `sharp.stats()` + `culori`     | OKLCH `{ l, c, h }`                    |
| `dominant_color_css` | Computed                       | `oklch(0.65 0.15 250)` CSS string      |
| `exif_orientation`   | `sharp.metadata().orientation` | EXIF orientation tag (1-8)             |
| `has_icc_profile`    | `sharp.metadata().hasProfile`  | ICC profile presence                   |
| `density`            | `sharp.metadata().density`     | DPI/PPI if available                   |

### Dominant Color in OKLCH

```typescript
import { converter } from 'culori';

const toOklch = converter('oklch');
const stats = await sharp(input).stats();
const { r, g, b } = stats.dominant;

const oklch = toOklch({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 });
// oklch = { mode: 'oklch', l: 0.65, c: 0.15, h: 250 }
// CSS: oklch(0.65 0.15 250)
```

OKLCH is ideal because:

- **Perceptually uniform**: Equal numeric changes = equal visual changes
- **Adjustable lightness**: Change `l` to make the color lighter/darker for backgrounds vs accents
- **CSS native**: `oklch()` is supported in all modern browsers
- **Gamut mapping**: Works with wide-gamut displays (Display P3)

Example usage in CSS:

```css
/* Use dominant color as background (lightened) */
.card {
	background: oklch(0.95 0.03 250);
}

/* Use dominant color as accent (full saturation) */
.badge {
	background: oklch(0.65 0.15 250);
}
```

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
IMAGE_PROCESSOR_STANDARD_SIZE = "2048"          # Standard variant max dimension
IMAGE_PROCESSOR_THUMBNAIL_SIZE = "640"          # Thumbnail variant max dimension
IMAGE_PROCESSOR_AVIF_QUALITY = "50"             # AVIF quality (1-100)
IMAGE_PROCESSOR_AVIF_EFFORT = "4"               # AVIF effort (0-9)
IMAGE_PROCESSOR_SLEEP_AFTER = "5m"              # Container idle timeout
```

### Programmatic Configuration

```typescript
import {
	ImageProcessorContainer,
	createImageProcessor,
} from '@delightstack/image-processor';

// Re-export for Cloudflare to discover
export { ImageProcessorContainer };

// Create a configured processor
const imageProcessor = createImageProcessor({
	keep_original: true,
	standard_size: 2048,
	thumbnail_size: 640,
	avif_quality: 50,
	avif_effort: 4,
	max_file_size: 50 * 1024 * 1024,
	// Custom variants in addition to defaults
	extra_variants: [
		{ name: 'social', max_dimension: 1200, format: 'jpeg', quality: 85 },
		{ name: 'banner', max_dimension: 1920, format: 'webp', quality: 75 },
	],
});

export default {
	async fetch(request: Request, env: Env) {
		const result = await imageProcessor.process(env.IMAGE_PROCESSOR, {
			bucket: env.MEDIA_BUCKET,
			key: 'uploads/photo.jpg',
		});
		return Response.json(result);
	},
};
```

---

## Container Internals

### Docker Image

```dockerfile
FROM node:22-alpine AS builder

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

FROM node:22-alpine AS runtime

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
COPY package.json package-lock.json ./
RUN npm ci --production
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
```

**Architecture:** `linux/amd64` (Cloudflare Containers requirement)

**Expected image size:** ~250-350 MB (Node.js + libvips + all codec libraries). This fits comfortably within even the `lite` instance type's 2 GB disk.

**Instance type recommendation:**

- `standard-1` (0.5 vCPU, 4 GiB RAM) for most workloads
- `standard-2` (1 vCPU, 6 GiB RAM) for processing very large RAW files or high-throughput scenarios

### Container HTTP Server

The container runs a minimal HTTP server (e.g., Fastify or plain `http`) with a single endpoint:

```
POST /process
Content-Type: multipart/form-data

- Part 1: JSON options (processing config)
- Part 2: Binary image data

Response: multipart/form-data
- Part 1: JSON result (metadata + variant info)
- Part 2+: Binary variant data (one part per variant)
```

Or, more simply, if we let the DO handle R2 I/O:

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

The DO receives this multipart response, writes each variant to R2, and returns the final `ProcessImageResult` JSON to the worker.

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
  key TEXT NOT NULL,                    -- R2 key of original/primary file
  file_name TEXT NOT NULL,              -- Original filename
  mime_type TEXT NOT NULL,              -- Detected MIME type
  file_size INTEGER NOT NULL,           -- Original file size in bytes
  width INTEGER NOT NULL,               -- Original width (orientation-corrected)
  height INTEGER NOT NULL,              -- Original height (orientation-corrected)
  aspect_ratio REAL NOT NULL,           -- width/height float
  has_transparency INTEGER NOT NULL,    -- 0 or 1
  is_animated INTEGER NOT NULL,         -- 0 or 1
  frame_count INTEGER NOT NULL,         -- Number of frames
  dominant_color_l REAL,                -- OKLCH lightness
  dominant_color_c REAL,                -- OKLCH chroma
  dominant_color_h REAL,                -- OKLCH hue
  thumbhash TEXT NOT NULL,              -- ThumbHash base64
  tiny_preview TEXT NOT NULL,           -- Base64 data URI
  variants TEXT NOT NULL,               -- JSON array of variant info
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
			key: result.original.key || key,
			file_name: result.metadata.file_name,
			mime_type: result.metadata.mime_type,
			file_size: result.metadata.file_size,
			width: result.metadata.width,
			height: result.metadata.height,
			aspect_ratio: result.metadata.aspect_ratio,
			has_transparency: result.metadata.has_transparency,
			is_animated: result.metadata.is_animated,
			frame_count: result.metadata.frame_count,
			dominant_color_l: result.metadata.dominant_color.l,
			dominant_color_c: result.metadata.dominant_color.c,
			dominant_color_h: result.metadata.dominant_color.h,
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

	// 3. Save metadata to database
	const dbStub = env.APP_DATABASE.get(env.APP_DATABASE.idFromName('main'));
	const response = await dbStub.fetch('https://db/image/create', {
		method: 'POST',
		body: JSON.stringify({
			key,
			...result.metadata,
			thumbhash: result.thumbhash,
			tiny_preview: result.tiny_preview,
			variants: result.variants,
		}),
	});

	// 4. Return to client
	return Response.json({ ok: true, image: await response.json() });
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

### Why Node.js + Sharp (not Rust, Go, or Python)

| Factor                      | Node.js + Sharp                                    | Rust                                            | Go                               | Python                         |
| --------------------------- | -------------------------------------------------- | ----------------------------------------------- | -------------------------------- | ------------------------------ |
| **Processing engine**       | libvips (via Sharp)                                | image-rs or libvips FFI                         | bimg (libvips)                   | Pillow or pyvips               |
| **Format breadth**          | Excellent (all via libvips)                        | Limited (no HEIC, no PDF, no RAW without C FFI) | Same as Sharp (both use libvips) | Good (via Pillow plugins)      |
| **Performance**             | Excellent (C-level via libvips)                    | Excellent (native)                              | Excellent (C-level via libvips)  | Slower (GIL + Python overhead) |
| **Memory efficiency**       | Excellent (libvips streaming)                      | Good                                            | Excellent (libvips streaming)    | Poor (Pillow loads full image) |
| **Ecosystem for this task** | Best (sharp, file-type, culori, thumbhash all npm) | Fragmented                                      | Decent                           | Rich but slow                  |
| **Docker image size**       | ~300 MB                                            | ~200 MB                                         | ~250 MB                          | ~400 MB                        |
| **Developer familiarity**   | Matches rest of Delightstack (TypeScript)          | Different language                              | Different language               | Different language             |
| **Community/maintenance**   | Sharp: 29K stars, very active                      | image-rs: 5K stars                              | bimg: 4K stars                   | Pillow: 12K stars              |

**Decision: Node.js + Sharp.** Same language as the rest of Delightstack. Sharp has the best libvips binding, the largest community, and the richest ecosystem of complementary packages. The container runs in Docker so we have full access to native dependencies (no Cloudflare Workers restrictions).

### Why ThumbHash (not BlurHash)

ThumbHash is strictly superior: encodes more detail, supports transparency, includes aspect ratio, requires no configuration, and is similarly tiny (~33 chars base64 vs ~25 chars for BlurHash).

### Why OKLCH for Dominant Color (not hex/RGB/HSL)

- Perceptually uniform (adjusting lightness gives predictable visual results)
- Native CSS support (`oklch()`)
- Easy to derive backgrounds (increase `l`), accents (keep original), and text colors (check contrast)
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

### 2. Async Processing Option

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
│   ├── dominant-color.ts      # Dominant color extraction + OKLCH conversion
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
// result.metadata.dominant_color_css → "oklch(0.65 0.12 245)"
// result.variants[0].key → "processed/photo/standard.avif"
// result.variants[1].key → "processed/photo/thumbnail.avif"
```

You give it a bucket and a key. It gives you back everything you need to display that image beautifully on a website, including instant placeholder previews, optimized variants, and rich metadata. No webhooks. No background jobs. No configuration beyond the basics.
