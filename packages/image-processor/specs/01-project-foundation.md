# 01 — Project Foundation

**Dependencies:** none
**Files created:** `package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`, `src/errors.ts`

## Overview

Set up the package scaffolding, define all shared TypeScript types, and implement the error class hierarchy. Everything else builds on this.

## Tasks

- [x] Create `package.json` with dependencies and exports map
- [x] Create `tsconfig.json` for `src/` (worker-side code)
- [x] Create `src/types.ts` with all shared interfaces
- [x] Create `src/errors.ts` with error class hierarchy
- [x] Create `src/index.ts` barrel export
- [x] Verify the package builds cleanly with `tsc --noEmit`

## Details

### package.json

The package has two separate dependency contexts:

1. **Worker-side** (`package.json` at the root) — lightweight, no native deps. Used by consuming apps.
2. **Container-side** (`docker/package.json`) — heavy, native deps (sharp, etc.). Only runs inside Docker.

Root `package.json`:

```
name: @delightstack/image-processor
type: module
dependencies:
  - @delightstack/database (workspace:*)   — for defineImageTable() types
  - thumbhash                              — for decodeThumbHash() (pure JS, works in Workers)
  - zod                                    — for runtime validation of options
devDependencies:
  - @cloudflare/workers-types
  - @cloudflare/containers                 — types for Container base class
  - typescript
  - vitest
```

Exports map:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./component": "./src/Image.svelte"
  }
}
```

The Svelte component is a separate export so non-Svelte consumers don't pull it in.

### tsconfig.json

Standard Delightstack config. Target `esnext`, module `esnext`, strict. Include `src/**/*`. Exclude `docker/`, `tests/`, `specs/`.

### src/types.ts

Define all interfaces from DESIGN.md. These are the shared types used by both worker-side code and referenced by consumers:

- `ProcessImageOptions` — bucket, key, keep_original, compress_original, variants, avatar
- `VariantConfig` — name, max_dimension, format, quality, effort, fit, watermark
- `WatermarkConfig` — text, image, layout, opacity, rotation, gap, position, scale
- `UploadOptions` — prefix, file_name, alt_text, keep_original, compress_original, variants, avatar, data
- `ProcessImageResult` — ok, job_id, metadata, thumbhash, variants
- `ImageMetadata` — all metadata fields from DESIGN.md
- `OutputVariant` — name, key, mime_type, width, height, file_size, is_animated, fit, watermarked
- `ContainerProcessResult` — internal result type returned by the container (includes binary data for variants)
- `ImageRecord` — the shape of a database image record (matches the SQL schema columns)
- `CreateImageHandleOptions` — options for the CDN hook factory

Keep `WatermarkConfig` as a separate named type extracted from `VariantConfig.watermark` so it can be referenced independently.

### src/errors.ts

```
ImageProcessorError extends Error
  - code: string
  - status: number
  - details?: Record<string, unknown>

ValidationError extends ImageProcessorError (status = 400)
ProcessingError extends ImageProcessorError (status = 500)
TimeoutError extends ImageProcessorError (status = 504)
```

Each error code from DESIGN.md maps to a specific subclass:

- `FILE_TOO_LARGE`, `DIMENSIONS_TOO_LARGE`, `UNSUPPORTED_FORMAT`, `TOO_MANY_FRAMES`, `CORRUPTED_FILE`, `SVG_MALICIOUS` → `ValidationError`
- `FILE_NOT_FOUND` → `ValidationError` (status 404)
- `PROCESSING_TIMEOUT` → `TimeoutError`
- `CONTAINER_UNAVAILABLE` → `ProcessingError` (status 503)
- `INTERNAL_ERROR` → `ProcessingError`

Provide a factory function `createError(code, details?)` that constructs the right subclass based on the code. This is used by both worker-side and container-side code.

### src/index.ts

Barrel export of everything except the Svelte component:

```ts
export * from './types';
export * from './errors';
export { ImageProcessorContainer } from './container';
export { processImage } from './process';
export { imageProcessing } from './integration';
export { defineImageTable } from './schema';
export { createImageHandle } from './handle';
export { decodeThumbHash, imageURL } from './image-helpers';
```

The component is exported via the `./component` package export, not the main entrypoint.
