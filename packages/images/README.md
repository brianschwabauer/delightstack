# @delightstack/images

Cloudflare Container-based image processing: resize, format conversion, metadata extraction, ThumbHash generation, face-aware avatar cropping, and watermarks. Deploy with wrangler, use via a Workers binding.

## Quickstart (Mode 1: Database Integration)

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

**3. Wire into your database DO:**

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

**4. Upload in your worker:**

```typescript
const image = await db.images.upload(file, {
  alt_text: 'Beach sunset',
  data: { user_id: currentUser.id },
});
// Returns immediately with status: 'pending'
// Processing happens asynchronously via DO alarm
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

## Quickstart (Mode 2: Standalone)

For direct synchronous processing without database integration:

```typescript
import { ImageProcessorContainer, processImage } from '@delightstack/images';

export { ImageProcessorContainer };

const result = await processImage(env.IMAGE_PROCESSOR, {
  bucket: env.MEDIA_BUCKET,
  key: 'uploads/photo.jpg',
});
// result.metadata, result.thumbhash, result.variants
```

## Exports

| Export | Description |
|--------|-------------|
| `ImageProcessorContainer` | Container DO class (re-export from your worker) |
| `processImage()` | Standalone synchronous processing (Mode 2) |
| `imageProcessing()` | Database integration factory with `upload`, `delete`, `retry`, `getStatus`, `processAlarm` |
| `defineImageTable()` | Database schema helper (accepts optional callback for custom fields) |
| `createImageHandle()` | SvelteKit server hook for serving images from R2 with ETag/304 |
| `decodeThumbHash()` | Decode base64 thumbhash to `data:image/png` URL (works server-side) |
| `imageURL()` | Build CDN URLs: `imageURL(id, variant?, prefix?)` |
| `Image` | Svelte 5 component (import from `@delightstack/images/component`) |

## Image Component

Three-tier progressive loading: background color (instant) → ThumbHash placeholder (blurred ~32x32 preview) → full image (300ms fade).

```svelte
<!-- Hero: SSR placeholder, eager load -->
<Image image={hero} alt="Welcome" ssr_placeholder loading="eager" />

<!-- Grid: lazy load with responsive sizes -->
{#each photos as photo}
  <Image image={photo} sizes="(max-width: 768px) 50vw, 33vw" />
{/each}

<!-- Avatar: cover fit -->
<div style="width: 48px; height: 48px; border-radius: 50%; overflow: hidden;">
  <Image image={user.avatar} alt={user.name} />
</div>
```

## Features

- **Format conversion**: AVIF, WebP, JPEG, PNG output
- **Variant generation**: Configurable resize strategies (`inside`/`cover`), quality, and format per variant
- **Metadata extraction**: Dimensions, EXIF, GPS, color space, ICC profiles
- **Color analysis**: Background color (1x1 resize → OKLCH), accent color (node-vibrant → OKLCH)
- **ThumbHash**: ~33 char base64 placeholder for instant blur-up previews
- **Avatar mode**: Face-aware square crop with MediaPipe BlazeFace
- **Watermarks**: Text or image, repeat/center/corner layouts, opacity, rotation
- **Special formats**: SVG sanitization, PDF first-page rendering, animated GIF/WebP/APNG
- **CDN serving**: ETag/304, immutable caching, SVG 404 placeholder with `no-cache`

## Architecture

```
Worker ─── imageProcessing(db, opts) ─── Database DO
                                              │
                                              ├── R2 (original upload)
                                              ├── DO alarm (async trigger)
                                              │
                                              └── Container DO ─── Docker (Bun + Sharp)
                                                                        │
                                                                        └── multipart response
                                                                              (JSON metadata + binary variants)
```

The Docker container runs Sharp/libvips with full format support. It has no internet access — watermark images are pre-fetched by the Container DO. The container sleeps when idle (scale-to-zero, ~2-3s cold start).

See [DESIGN.md](./DESIGN.md) for the full specification.
