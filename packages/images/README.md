# @delightstack/images

Cloudflare Container-based image processing for Cloudflare Workers. Upload an image, get back optimized variants, rich metadata, ThumbHash placeholders, extracted colors, and everything else needed to display images beautifully on the web.

## Features

- **Optimized variants** -- Resize and encode to AVIF, WebP, JPEG, or PNG with configurable quality and fit strategies
- **Rich metadata** -- Dimensions, EXIF (orientation, GPS, date taken), color space, ICC profile, bit depth, frame count
- **Color extraction** -- Background color (1x1 resize) and accent color (node-vibrant), both in OKLCH for native CSS use
- **ThumbHash placeholders** -- ~33 char base64 hash decoded to a blurred ~32x32 preview; supports transparency and aspect ratio
- **Face-aware avatar cropping** -- MediaPipe BlazeFace detection for intelligent square crops
- **Watermarks** -- Text or image overlays with repeat/center/corner layouts, opacity, rotation, and gap control
- **Special format handling** -- SVG sanitization, PDF first-page rendering, animated GIF/WebP/APNG preservation
- **CDN serving** -- SvelteKit hook with ETag/304, immutable caching, and SVG 404 placeholder
- **Svelte 5 component** -- Three-tier progressive loading with background color, ThumbHash blur-up, and smooth fade
- **Two integration modes** -- Async database-backed processing (Mode 1) or synchronous standalone calls (Mode 2)

## Architecture

The package has two halves: **worker-side code** (runs in your Cloudflare Worker) and a **Docker container** (runs in Cloudflare Containers with full native library access).

```
┌───────────────────────────────────────────────────────────────────────┐
│  Your Worker / Database DO                                            │
│                                                                       │
│  ┌──────────────────┐    ┌──────────┐    ┌──────────────────────────┐ │
│  │ imageProcessing()│───▶│ R2 Bucket│    │ Container Durable Object │ │
│  │ or processImage()│    │ (storage)│    │ (ImageProcessorContainer)│ │
│  └────────┬─────────┘    └──────────┘    └───────────┬──────────────┘ │
│           │                                          │                │
│           │              DO alarm / RPC call         │                │
│           └──────────────────────────────────────────┘                │
└───────────────────────────────────────────────────────────────────────┘
                                                       │
                                          Cloudflare Container bridge
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Docker Container (Bun + Sharp/libvips)                             │
│                                                                     │
│  HTTP POST /process                                                 │
│  ┌────────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ Validation │─▶│ Metadata  │─▶│ ThumbHash │─▶│ Variant encoding │ │
│  │ (size,dims)│  │ (EXIF,GPS)│  │ (32x32)   │  │ (resize, format) │ │
│  └────────────┘  └───────────┘  └───────────┘  └──────────────────┘ │
│                                                        │            │
│  Responds with multipart/mixed:                        ▼            │
│  Part 1: JSON (metadata + thumbhash + variant info)                 │
│  Part 2+: Binary variant data (one part per variant)                │
└─────────────────────────────────────────────────────────────────────┘
```

### Why this architecture?

**Why a separate Docker container?** Cloudflare Workers can't run native code like Sharp/libvips. Cloudflare Containers run full Docker images with native library access, giving us the entire Sharp ecosystem (AVIF, HEIC, RAW, PDF rendering via Poppler, face detection via MediaPipe). The container scales to zero when idle (~2-3s cold start) and has no internet access for security.

**Why a Container DO wrapping the container?** The Container DO manages the lifecycle -- it boots the container on first request and provides a stable RPC interface. It also pre-fetches watermark images from R2 before sending them to the container (which has no network access).

**Why alarms for async processing?** Durable Object alarms are durable timers that survive Worker restarts. When you upload an image, the DO schedules an alarm, stores processing options in SQLite, and returns immediately. The alarm fires, processes the image, and updates the database record. If processing fails, the alarm retries with exponential backoff. This is simpler and more reliable than queues or external job systems -- no extra infrastructure, no delivery guarantees to worry about, and the retry logic lives right next to the data.

**Why multipart/mixed responses?** The container needs to return JSON metadata alongside multiple binary image variants in a single HTTP response. Multipart/mixed avoids base64-encoding overhead and lets us stream binary data directly. The worker-side code parses the boundary-delimited parts and uploads each variant to R2.

**Why extensionless R2 keys?** Image variants are stored at keys like `images/{id}/default` with no file extension. The format is stored in R2's Content-Type metadata. This means you can change output formats (e.g., switch from WebP to AVIF) without changing any URLs -- existing keys still work, and `Cache-Control: immutable` means browsers keep using cached versions until the ID changes.

## Quickstart (Mode 1: Database Integration)

Async, non-blocking processing with automatic database tracking. Best for apps where users upload images and you want processing to happen in the background.

**1. Install:**

```bash
pnpm add @delightstack/images
```

**2. Add to `wrangler.toml`:**

```toml
[[containers]]
class_name = "ImageProcessorContainer"
image = "node_modules/@delightstack/images/container"
max_instances = 5
instance_type = "standard-1"

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

**3. Wire into your database Durable Object:**

```typescript
import { DatabaseServer } from '@delightstack/database';
import {
	ImageProcessorContainer,
	imageProcessing,
	defineImageTable,
} from '@delightstack/images';

export { ImageProcessorContainer };

export class AppDatabase extends DatabaseServer<typeof dbConfig> {
	readonly images = imageProcessing(this, {
		container: () => this.env.IMAGE_PROCESSOR,
		bucket: () => this.env.MEDIA_BUCKET,
	});

	async alarm() {
		await this.images.processAlarm();
	}
}
```

**4. Upload in your worker (or sveltekit app):**

```typescript
const image = await db.images.upload(file, {
	alt_text: 'Beach sunset',
	data: { user_id: currentUser.id },
});
// Returns immediately with processing_status: 'pending'
// Processing happens asynchronously via Durable Object alarm
```

**5. Serve via CDN hook:**

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createImageHandle } from '@delightstack/images';

const imageHandle = createImageHandle({
	bucket: (event) => event.platform!.env.MEDIA_BUCKET,
});

export const handle = sequence(imageHandle, ...otherHandles);
```

**6. Display with the Svelte component:**

```svelte
<script>
	import Image from '@delightstack/images/component';
</script>

<Image image={photo} />
```

### Mode 1 processing flow

```
upload(file, opts)
  │
  ├── 1. Generate unique ID (timestamp-based)
  ├── 2. Upload original to R2 at {prefix}/{id}/original
  ├── 3. Create database record (status: 'pending')
  ├── 4. Schedule DO alarm (fires in ~100ms)
  └── 5. Return record immediately
         │
         ▼
processAlarm()
  │
  ├── 1. Query pending images from SQLite
  ├── 2. Update status to 'processing'
  ├── 3. Send original bytes to image processing container via RPC
  ├── 4. Container returns: metadata + thumbhash + variant binaries
  ├── 5. Upload each variant to R2 (parallel)
  ├── 6. Update database record with all metadata
  ├── 7. Set status to 'processed'
  └── 8. If more pending images exist, schedule another alarm
```

## Quickstart (Mode 2: Standalone)

Synchronous processing for one-off jobs where you don't need database tracking:

```typescript
import { ImageProcessorContainer, processImage } from '@delightstack/images';

export { ImageProcessorContainer };

const result = await processImage(env.IMAGE_PROCESSOR, {
	bucket: env.MEDIA_BUCKET,
	key: 'uploads/photo.jpg',
});
// result.metadata   → dimensions, EXIF, colors, etc.
// result.thumbhash  → "3OcRJYB4d3h/iIeHeEh3eIhw+j2w"
// result.variants   → [{ name: 'default', key: 'images/.../default', ... }]
```

## CDN Hook

The `createImageHandle()` function returns a SvelteKit `Handle` that serves images directly from R2. No database lookup needed -- everything required to serve the image (Content-Type, Cache-Control, dimensions) is stored as R2 object metadata.

```
GET /cdn/image/{id}/{variant}
  │
  ├── If-None-Match header present?
  │   └── Yes: HEAD request to R2, compare ETag → 304 Not Modified
  │
  ├── GET from R2 at {prefix}/{id}/{variant}
  │   ├── Found → 200 with immutable cache headers
  │   └── Not found → 404 SVG placeholder (Cache-Control: no-cache)
  │
  └── Headers set:
      ├── Cache-Control: public, max-age=31536000, immutable
      ├── ETag: (from R2 object)
      ├── X-Image-Width / X-Image-Height (from R2 custom metadata)
      └── Content-Disposition (for 'original' variant, preserves filename)
```

The 404 placeholder uses `Cache-Control: no-cache` so the browser retries once processing completes. Once the image exists, it gets `immutable` caching -- the ID is unique, so the content never changes.

## Image Component

The Svelte 5 component provides three-tier progressive loading:

```
1. Background color (immediate, CSS only, no JS needed)
   └── Uses image.background_color as oklch() CSS value
   └── Prevents white flash, matches the image's dominant color

2. ThumbHash placeholder (SSR or after hydration)
   └── ssr_placeholder=true  → decoded on server, in initial HTML
   └── ssr_placeholder=false → decoded on client after JS loads
   └── ~32x32 blurred preview, preserves aspect ratio

3. Full image (after browser fetches the best srcset variant)
   └── 300ms opacity fade from placeholder to loaded image
   └── Cached images skip the fade (detected via img.complete)
```

```svelte
<script>
  import Image from '@delightstack/images/component';
</script>

<!-- Hero: SSR placeholder, eager load, no flash -->
<Image image={hero} alt="Welcome" ssr_placeholder loading="eager" />

<!-- Grid: lazy load with responsive sizes -->
{#each photos as photo}
  <Image image={photo} sizes="(max-width: 768px) 50vw, 33vw" />
{/each}

<!-- Avatar: cover fit -->
<div style="width: 48px; height: 48px; border-radius: 50%; overflow: hidden;">
  <Image image={user.avatar} alt={user.name} />
</div>

<!-- Building URLs outside the component -->
<script>
  import { imageURL, decodeThumbHash } from '@delightstack/images';
</script>
<svelte:head>
  <meta property="og:image" content={imageURL(image.id, 'default')} />
</svelte:head>
<a href={imageURL(image.id, 'original')} download>Download original</a>
```

The component automatically builds a `srcset` from all non-original, non-watermarked variants and uses the `sizes` prop to let the browser pick the best one. Error recovery retries up to 3 times with exponential backoff (1s, 4s, 9s).

## Processing Pipeline

The container runs different pipelines depending on the input format:

```
Input file
  │
  ├── Validate (size limits, dimension limits, supported format)
  │
  ├── Detect MIME type (magic bytes, not file extension)
  │
  ├─── SVG?
  │    ├── Sanitize (remove scripts, event handlers, data: URLs, external refs)
  │    ├── Extract dimensions from viewBox/width/height
  │    ├── Generate ThumbHash (rasterize to 100px, resize to 32x32)
  │    └── Store sanitized SVG as-is (no variant encoding)
  │
  ├─── PDF?
  │    ├── Render first page to PNG (150 DPI via Poppler)
  │    └── Process rendered PNG through the image pipeline below
  │
  └─── Image (JPEG, PNG, WebP, AVIF, HEIC, GIF, APNG, TIFF, RAW...)
       │
       ├── Extract metadata (Sharp: dimensions, orientation, EXIF, GPS, ICC)
       ├── Extract colors (1x1 resize → background OKLCH, node-vibrant → accent OKLCH)
       ├── Generate ThumbHash (resize to ≤100px, 4-channel RGBA)
       │
       ├── Avatar mode?
       │   ├── Yes: Face detection (MediaPipe) → square crop around largest face
       │   └── No face found: Attention-based crop (Sharp strategy)
       │
       ├── For each variant config:
       │   ├── Resize (inside or cover fit)
       │   ├── Animated? Resize all frames, encode as WebP (not AVIF)
       │   ├── Has transparency? Preserve alpha channel, skip JPEG
       │   ├── Apply watermark if configured
       │   └── Encode to target format
       │
       └── Compressed original? Re-encode at full resolution as AVIF
```

### Default variants

When no custom variants are specified:

| Variant     | Max dimension | Format | Quality | Fit    |
| ----------- | ------------- | ------ | ------- | ------ |
| `default`   | 2048px        | AVIF   | 50      | inside |
| `thumbnail` | 640px         | AVIF   | 50      | cover  |

Plus an `original` variant (the uploaded file preserved as-is) and optionally a compressed original (full-resolution AVIF re-encode).

**Fit strategies:**

- `inside` -- The long edge fits within `max_dimension`. An 8000x6000 photo at max 2048 becomes 2048x1536. Good for detail views.
- `cover` -- The short edge fits within `max_dimension`. The same photo at max 640 becomes 854x640. Good for thumbnails where you want to fill a fixed-size container.

## Supported Formats

**Input formats:**

| Category     | Formats                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Common       | JPEG, PNG, WebP, AVIF, GIF                                                                                                     |
| Apple/Mobile | HEIC, HEIF                                                                                                                     |
| Professional | TIFF                                                                                                                           |
| Camera RAW   | NEF (Nikon), CR2/CR3 (Canon), ARW (Sony), ORF (Olympus), RW2 (Panasonic), RAF (Fuji), PEF (Pentax), SRW (Samsung), DNG (Adobe) |
| Vector       | SVG (sanitized)                                                                                                                |
| Document     | PDF (first page)                                                                                                               |
| Animated     | GIF, APNG, animated WebP                                                                                                       |

**Output formats:** AVIF (default), WebP, JPEG, PNG. SVGs are stored as-is after sanitization.

## Input Limits

| Constraint             | Limit              |
| ---------------------- | ------------------ |
| File size (images)     | 50 MB              |
| File size (camera RAW) | 100 MB             |
| File size (SVG)        | 5 MB               |
| File size (PDF)        | 50 MB              |
| Pixel dimensions       | 256 megapixels max |
| Single side            | 32,768px max       |

## Error Codes

| Code                    | Status | When                                                       |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `FILE_NOT_FOUND`        | 404    | R2 key doesn't exist                                       |
| `FILE_TOO_LARGE`        | 400    | Exceeds size limit for its format                          |
| `DIMENSIONS_TOO_LARGE`  | 400    | Exceeds pixel or single-side limit                         |
| `UNSUPPORTED_FORMAT`    | 400    | Unrecognized or blocked MIME type                          |
| `TOO_MANY_FRAMES`       | 400    | Animated image exceeds frame limit                         |
| `CORRUPTED_FILE`        | 400    | Can't decode the image data                                |
| `SVG_MALICIOUS`         | 400    | SVG contains scripts, event handlers, or dangerous content |
| `PROCESSING_TIMEOUT`    | 504    | Processing exceeded 60 seconds                             |
| `CONTAINER_UNAVAILABLE` | 503    | Container failed to start                                  |
| `INTERNAL_ERROR`        | 500    | Unexpected error                                           |

## Design Decisions

### Why AVIF as default output (not WebP or JPEG)

AVIF at quality 50 matches JPEG at quality 80-85 perceptually, at roughly half the file size. It's ~20-30% smaller than WebP at equivalent visual quality. All modern browsers support AVIF (Chrome, Firefox, Safari 16+, Edge). For animated content, we fall back to WebP since AVIF animation support is still immature.

### Why ThumbHash (not BlurHash)

ThumbHash is strictly superior for our use case: it encodes more detail, supports transparency, includes aspect ratio, requires no configuration (no component count tuning), and is similarly tiny (~33 chars base64 vs ~25 for BlurHash).

### Why OKLCH for colors (not hex/RGB/HSL)

OKLCH is perceptually uniform -- adjusting the `l` (lightness) component gives predictable visual results. It has native CSS support via `oklch()`. The `l` and `c` components make it trivial to create light/dark/muted theme variations programmatically. It's part of CSS Colors Level 4 and is the future default for color manipulation.

### Why Bun + Sharp in the container

Same language as the rest of the stack (TypeScript). Bun provides fast startup and native TS execution (no build step). Sharp wraps libvips, the fastest open-source image processing library, with the largest npm ecosystem of complementary packages (file-type, culori, thumbhash, node-vibrant, MediaPipe). The container runs in Docker, so we have full native library access without Workers restrictions.

### Why separate DOs (not merging container into the database DO)

The database DO handles your app's business logic. The container DO manages a Docker container lifecycle. Merging them would mean every database DO instance boots a container, even if it never processes images. Keeping them separate means the container scales independently (most apps need far fewer container instances than database instances), and you can share one container across multiple databases.

## Exports

| Export                    | Import                           | Description                                                                                         |
| ------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ImageProcessorContainer` | `@delightstack/images`           | Container DO class -- re-export from your worker                                                    |
| `processImage()`          | `@delightstack/images`           | Standalone synchronous processing (Mode 2)                                                          |
| `imageProcessing()`       | `@delightstack/images`           | Database integration factory (Mode 1) with `upload`, `delete`, `retry`, `getStatus`, `processAlarm` |
| `defineImageTable()`      | `@delightstack/images`           | Database schema helper for `@delightstack/database`                                                 |
| `createImageHandle()`     | `@delightstack/images`           | SvelteKit server hook for serving images from R2                                                    |
| `decodeThumbHash()`       | `@delightstack/images`           | Decode base64 thumbhash to `data:image/png` URL (works server-side)                                 |
| `imageURL()`              | `@delightstack/images`           | Build CDN URLs: `imageURL(id, variant?, prefix?)`                                                   |
| `Image`                   | `@delightstack/images/component` | Svelte 5 progressive-loading component                                                              |

All types are also exported from the main entry point (`ErrorCode`, `WatermarkConfig`, `VariantConfig`, `ProcessImageOptions`, `UploadOptions`, `ImageMetadata`, `OutputVariant`, `ProcessImageResult`, `ImageRecord`, `CreateImageHandleOptions`, `ImageProcessingOptions`, etc.).

## Project Structure

```
packages/images/
├── package.json
├── tsconfig.json
│
├── src/                        # Worker-side code (imported by consuming apps)
│   ├── index.ts                # Public API re-exports
│   ├── types.ts                # All TypeScript types and interfaces
│   ├── errors.ts               # ImageProcessorError, ValidationError, ProcessingError
│   ├── container.ts            # ImageProcessorContainer DO class + multipart parser
│   ├── process.ts              # processImage() -- standalone Mode 2 helper
│   ├── integration.ts          # imageProcessing() -- Mode 1 database integration factory
│   ├── schema.ts               # defineImageTable() for @delightstack/database
│   ├── handle.ts               # createImageHandle() -- SvelteKit CDN hook
│   ├── image-helpers.ts        # decodeThumbHash(), imageURL()
│   └── Image.svelte            # Svelte 5 image component
│
├── container/                  # Docker container (Cloudflare Containers)
│   ├── Dockerfile              # Multi-stage build: Bun + Alpine + libvips + Poppler
│   ├── package.json            # Container-only deps: sharp, file-type, culori, etc.
│   └── src/
│       ├── server.ts           # Bun.serve HTTP server on port 8080
│       ├── pipeline.ts         # Pipeline orchestration (routes to SVG/PDF/image flows)
│       ├── validation.ts       # Input validation (size, dimensions, format)
│       ├── mime.ts             # MIME detection from magic bytes
│       ├── metadata.ts         # EXIF, GPS, dimensions, orientation, animation
│       ├── colors.ts           # Background + accent color extraction (OKLCH)
│       ├── thumbhash.ts        # ThumbHash generation
│       ├── variants.ts         # Variant resize + encode (AVIF/WebP/JPEG/PNG)
│       ├── face-crop.ts        # Face detection + square crop (MediaPipe)
│       ├── watermark.ts        # Text/image watermark compositing
│       ├── svg.ts              # SVG sanitization + dimension extraction
│       ├── pdf.ts              # PDF first-page rendering (Poppler)
│       └── vendor.d.ts         # Type declarations for third-party modules
│
└── tests/
    ├── e2e-mode1.test.ts       # End-to-end: database integration flow
    ├── e2e-mode2.test.ts       # End-to-end: standalone processing flow
    ├── handle.test.ts          # CDN hook tests
    └── image-helpers.test.ts   # Helper utility tests
```

## Cost and Performance

### Processing time estimates

| Input                     | Size   | Time  |
| ------------------------- | ------ | ----- |
| JPEG photo (12MP)         | 5 MB   | 1-3s  |
| PNG with transparency     | 10 MB  | 2-4s  |
| HEIC from iPhone (48MP)   | 8 MB   | 3-5s  |
| Camera RAW (45MP)         | 50 MB  | 5-10s |
| Animated GIF (100 frames) | 20 MB  | 5-15s |
| PDF (first page)          | 10 MB  | 2-5s  |
| SVG (metadata only)       | 100 KB | <0.5s |

Add ~2-3s for cold start if the container was sleeping.

### Cost estimates (Cloudflare Containers, `standard-1`)

| Scenario                                             | Monthly cost |
| ---------------------------------------------------- | ------------ |
| 100 images/day, container sleeps most of the time    | ~$2-5        |
| 1,000 images/day, container active ~4 hours          | ~$10-20      |
| 10,000 images/day, container active most of the time | ~$40-80      |

Costs are dominated by R2 storage ($0.015/GB/month) and R2 operations ($4.50/million writes) for most workloads, not the container compute.
