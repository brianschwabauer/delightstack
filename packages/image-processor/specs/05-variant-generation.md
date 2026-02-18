# 05 — Variant Generation

**Dependencies:** 01, 04
**Files created:** `docker/variants.ts`

## Overview

Generate resized output variants from the processed image. Handles fit strategies (inside vs cover), format encoding, quality/effort settings, variant skipping, and compressed original. This is the core resize + encode step.

## Tasks

- [ ] Create `docker/variants.ts`
- [ ] Implement `generateVariants(sharpInstance, metadata, variantConfigs)` function
- [ ] Implement `inside` fit strategy (long edge fits within max_dimension)
- [ ] Implement `cover` fit strategy (short edge fits within max_dimension)
- [ ] Implement default fit selection (inside for >1024, cover for ≤1024)
- [ ] Implement variant skipping (skip if original long edge < max_dimension)
- [ ] Implement format encoding (AVIF, WebP, JPEG, PNG) with per-format quality defaults
- [ ] Implement compressed original (full-res AVIF re-encode preserving EXIF/ICC)
- [ ] Strip metadata from resized variants (not from compressed original)
- [ ] Return variant binary data + metadata (width, height, mime_type, file_size)
- [ ] Handle JPEG transparency (composite white background)
- [ ] Unit tests for fit strategies with known dimensions
- [ ] Unit tests for variant skipping logic
- [ ] Unit tests for compressed original with metadata preservation

## Details

### Core Function

```
generateVariants(
  sharpInstance: Sharp,
  metadata: ImageMetadata,
  configs: VariantConfig[],
  options: { compress_original: boolean; keep_original: boolean }
): Promise<GeneratedVariant[]>
```

Returns an array of `{ name, data: Buffer, width, height, mime_type, file_size, fit, watermarked }`.

### Fit Strategies

**`inside` (default when max_dimension > 1024):**

```ts
sharp(input).resize(max_dimension, max_dimension, { fit: 'inside', withoutEnlargement: true })
```

The long edge fits within `max_dimension`. A 4000x3000 image at 2048 → 2048x1536.

**`cover` (default when max_dimension ≤ 1024):**

```ts
sharp(input).resize(max_dimension, max_dimension, { fit: 'outside', withoutEnlargement: true })
```

Note: Sharp's `fit: 'outside'` resizes so the *short* edge matches the target — this is what the design calls "cover" (no cropping, just resize). A 4000x3000 image at 640 → 854x640.

`withoutEnlargement: true` prevents upscaling small images.

### Variant Skipping

Before processing each variant, check:

```ts
const longEdge = Math.max(metadata.width, metadata.height);
if (longEdge < config.max_dimension) {
  // Skip this variant — original is already smaller
  continue;
}
```

Log skipped variants for debugging but don't include them in the output.

### Format Encoding

Per format:

| Format | Sharp method | Default quality | Notes |
|--------|-------------|-----------------|-------|
| AVIF | `.avif({ quality, effort })` | q50, effort 4 | Best compression. Falls back to WebP for animated. |
| WebP | `.webp({ quality })` | q75 | Good fallback, supports animation + transparency. |
| JPEG | `.jpeg({ quality, mozjpeg: true })` | q80 | Use mozjpeg for better compression. No transparency. |
| PNG | `.png({ compressionLevel: 9 })` | lossless | Large files but pixel-perfect. |

For JPEG variants of transparent images, composite a white background first:

```ts
sharp(input).flatten({ background: '#ffffff' }).jpeg({ quality })
```

### Compressed Original

When `compress_original` is true and `keep_original` is true:

```ts
const compressed = await sharp(input, { keepMetadata: true })
  .avif({ quality: 50, effort: 4 })
  .toBuffer({ resolveWithObject: true });
```

Key difference from regular variants: `keepMetadata: true` preserves EXIF, ICC, and XMP metadata. Regular variants strip all metadata (smaller files, no privacy concerns for resized previews).

For animated inputs, use WebP instead of AVIF (AVIF animation support is immature in libvips).

### Default Variants

When `configs` is undefined/empty, use:

```ts
const DEFAULT_VARIANTS: VariantConfig[] = [
  { name: 'default', max_dimension: 2048, format: 'avif', quality: 50, effort: 4 },
  { name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4 },
];
```

Fit defaults are applied per-variant based on `max_dimension` (inside for >1024, cover for ≤1024) unless explicitly set.

### Output Shape

Each generated variant returns:

```ts
{
  name: string;
  data: Buffer;           // raw binary — written to R2 by the caller
  width: number;
  height: number;
  mime_type: string;      // e.g. 'image/avif'
  file_size: number;      // data.byteLength
  is_animated: boolean;
  fit: 'inside' | 'cover';
  watermarked: false;     // watermarks are applied in a later step
}
```
