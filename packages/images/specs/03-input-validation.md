# 03 — Input Validation & MIME Detection

**Dependencies:** 01
**Files created:** `container/src/validation.ts`, `container/src/mime.ts`

## Overview

Detect the true MIME type of uploaded files from magic bytes (not file extension) and enforce size, dimension, and format constraints. This runs inside the container as the first step of the processing pipeline.

## Tasks

- [x] Create `container/src/mime.ts` — MIME type detection via `file-type`
- [x] Create `container/src/validation.ts` — size, dimension, format validation
- [x] Handle edge case: file-type returns undefined (unknown format)
- [x] Handle edge case: SVG detection (file-type may not detect SVGs since they're text)
- [x] Unit tests for each validation error scenario
- [x] Unit tests for MIME detection across all supported formats

## Details

### container/src/mime.ts

Use the `file-type` npm package which reads magic bytes from the start of the file:

```
detectMimeType(data: ArrayBuffer): { mime_type: string; extension: string } | null
```

- Pass the first ~4100 bytes (file-type's minimum) to `fileTypeFromBuffer()`
- Return `{ mime_type, extension }` or `null` if unrecognized
- Special case: SVGs are text-based and file-type won't detect them. Check for `<?xml` or `<svg` prefix after file-type returns null. If found, return `{ mime_type: 'image/svg+xml', extension: 'svg' }`

### container/src/validation.ts

```
validateInput(data: ArrayBuffer, mimeResult): void  // throws on failure
```

**Step 1: Format check.** Compare `mime_type` against the supported format lists from DESIGN.md. If unsupported, throw `UNSUPPORTED_FORMAT`.

**Step 2: Size check.** Compare `data.byteLength` against the per-format limits:

| Category | Max Size |
|----------|----------|
| Standard images (JPEG, PNG, WebP, AVIF, etc.) | 50 MB |
| RAW camera files (NEF, CR2, ARW, DNG, etc.) | 100 MB |
| Animated images (GIF, animated WebP) | 50 MB |
| PDFs | 50 MB |
| SVGs | 5 MB |

If exceeded, throw `FILE_TOO_LARGE` with `{ max_bytes, actual_bytes }`.

Note: animated detection at this stage is approximate — we know it's a GIF (which might be animated) but don't know frame count yet. The frame count check happens later after Sharp loads the image.

**Step 3: Quick dimension check (if possible).** For formats where dimensions can be read from the header without decoding the entire image (JPEG, PNG, GIF headers), extract them cheaply. If dimensions exceed 256 megapixels or 32,768 on a single side, throw `DIMENSIONS_TOO_LARGE` early. This prevents Sharp from trying to decode a 100,000x100,000 pixel image. For formats where header-only dimension reading isn't practical, defer to the metadata extraction step.

### RAW Format Detection

Camera RAW files have varied magic bytes. The `file-type` package handles most common ones (NEF, CR2, ARW, DNG). For formats it doesn't recognize, the file will fail with `UNSUPPORTED_FORMAT` — this is acceptable since libraw (which Sharp uses) handles the actual decoding.

DNG files use the TIFF container format, so file-type may report them as `image/tiff`. Check the file extension (if available via the X-Options header) to disambiguate, or let Sharp handle it — Sharp/libraw will decode both TIFF and DNG correctly.

### Error Details

Every validation error includes enough context for the consumer to show a helpful message:

```ts
throw createError('FILE_TOO_LARGE', {
  max_bytes: 52_428_800,
  actual_bytes: data.byteLength,
});
```
