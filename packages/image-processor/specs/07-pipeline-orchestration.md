# 07 — Processing Pipeline Orchestration

**Dependencies:** 02, 03, 04, 05, 06
**Files created:** `docker/pipeline.ts`

## Overview

Wire together validation, metadata extraction, color analysis, variant generation, and ThumbHash into a single `process()` function that the HTTP server calls. This is the main entry point for all image processing inside the container. It handles the static image pipeline end-to-end and delegates to special format handlers (spec 08) when needed.

## Tasks

- [ ] Create `docker/pipeline.ts`
- [ ] Implement `process(data, options)` function — main entry point
- [ ] Wire pipeline stages: detect → validate → load → metadata → colors → variants → thumbhash
- [ ] Run independent stages in parallel where possible (colors + variants, etc.)
- [ ] Assemble `ContainerProcessResult` from all stages
- [ ] Handle compressed original (include in result if requested)
- [ ] Route to special format handlers (SVG, PDF, animated) based on MIME type
- [ ] Pass avatar flag through to face-crop (spec 12 — stub for now)
- [ ] Pass watermark configs through to watermark step (spec 13 — stub for now)
- [ ] Integration test: JPEG → full pipeline → result with metadata + variants + thumbhash
- [ ] Integration test: PNG with transparency → correct alpha handling
- [ ] Integration test: variant skipping with small image

## Details

### docker/pipeline.ts

```
process(
  data: ArrayBuffer,
  options: {
    variants?: VariantConfig[];
    compress_original?: boolean;
    avatar?: boolean;
    watermark_images?: Map<string, ArrayBuffer>;  // pre-fetched watermark image bytes
  }
): Promise<ContainerProcessResult>
```

### Pipeline Flow (Static Images)

```
1. detectMimeType(data)
   → { mime_type, extension }

2. validateInput(data, mimeResult)
   → throws on failure

3. Route based on mime_type:
   → 'image/svg+xml'  → svgPipeline(data, options)     [spec 08]
   → 'application/pdf' → pdfPipeline(data, options)     [spec 08]
   → default           → imagePipeline(data, mimeResult, options)

4. imagePipeline:
   a. Load with Sharp: sharp(Buffer.from(data)).rotate()
      (.rotate() applies EXIF orientation automatically)

   b. Check for animation: if meta.pages > 1 → animatedPipeline()  [spec 08]

   c. extractMetadata(sharpInstance, mimeResult, data.byteLength)

   d. In parallel:
      - extractColors(sharpInstance)
      - If avatar: faceCrop(sharpInstance, metadata)  [spec 12, stub returns input unchanged]

   e. generateVariants(sharpInstance, metadata, resolvedConfigs, { compress_original, keep_original })

   f. For each variant with watermark config:
      applyWatermark(variantBuffer, watermarkConfig, watermarkImages)  [spec 13, stub returns input unchanged]

   g. generateThumbHash(sharpInstance)  — from the (possibly cropped) source, not from a variant

   h. Assemble result
```

### Parallel Execution

Within the pipeline, several steps can run in parallel:

```ts
const [colors, croppedSharp] = await Promise.all([
  extractColors(sharpInstance),
  avatar ? faceCrop(sharpInstance, metadata) : sharpInstance,
]);
```

Variant generation is sequential per variant (each creates a new Sharp pipeline from the source). ThumbHash runs in parallel with variant generation since it uses a separate resize.

### Options Resolution

Merge user-provided options with defaults:

```ts
function resolveOptions(options, metadata) {
  const configs = options.variants ?? DEFAULT_VARIANTS;

  // Apply default fit per variant
  for (const config of configs) {
    if (!config.fit) {
      config.fit = config.max_dimension > 1024 ? 'inside' : 'cover';
    }
  }

  // Avatar defaults
  if (options.avatar) {
    // keep_original defaults to false, single thumbnail variant, etc.
    // See DESIGN.md Avatar Profile section
  }

  return { configs, compress_original, keep_original };
}
```

### Result Assembly

```ts
const result: ContainerProcessResult = {
  metadata: { ...coreMetadata, ...colors },
  thumbhash: base64ThumbHash,
  variants: generatedVariants.map(v => ({
    name: v.name,
    data: v.data,          // binary — will be written to R2 by caller
    width: v.width,
    height: v.height,
    mime_type: v.mime_type,
    file_size: v.file_size,
    is_animated: v.is_animated,
    fit: v.fit,
    watermarked: v.watermarked,
  })),
  compressed_original: compressedOriginal ?? null,  // if compress_original was true
};
```

### Stubs for Unimplemented Features

Until specs 08, 12, and 13 are implemented, provide pass-through stubs:

- `svgPipeline()` → throw `UNSUPPORTED_FORMAT` (temporary)
- `pdfPipeline()` → throw `UNSUPPORTED_FORMAT` (temporary)
- `animatedPipeline()` → process first frame as static (temporary)
- `faceCrop()` → return input unchanged
- `applyWatermark()` → return input unchanged

This lets the core static image pipeline work end-to-end while advanced features are added incrementally.

### Error Handling

Wrap the entire pipeline in try/catch. Map Sharp-specific errors to our error codes:

- Sharp "Input file is missing" → `CORRUPTED_FILE`
- Sharp "unsupported image format" → `UNSUPPORTED_FORMAT`
- Sharp VIPS errors → `INTERNAL_ERROR` with the VIPS error message in details
- Any other error → `INTERNAL_ERROR`
