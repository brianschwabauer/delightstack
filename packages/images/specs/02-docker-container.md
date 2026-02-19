# 02 — Docker Container Setup

**Dependencies:** 01
**Files created:** `container/Dockerfile`, `container/package.json`, `container/src/server.ts`

## Overview

Build the Docker image that runs inside Cloudflare Containers. It runs a Bun HTTP server that accepts image bytes, processes them, and returns results as a multipart response. This spec covers the Dockerfile, container dependencies, and the HTTP server skeleton — the actual processing logic (pipeline.ts, etc.) is wired in by spec 07.

## Tasks

- [x] Create `container/package.json` with container-only dependencies
- [x] Create `container/Dockerfile` (multi-stage: build libvips, runtime)
- [x] Create `container/src/server.ts` HTTP server with `POST /process` endpoint
- [x] Implement multipart response encoding (JSON metadata + binary variant parts)
- [x] Implement request parsing (raw body + X-Options header)
- [x] Add 60-second processing timeout wrapper
- [x] Add health check endpoint (`GET /health`)
- [x] Test: Docker image builds successfully
- [x] Test: Server starts and responds to health check

## Details

### container/package.json

Container-specific dependencies (these run inside Docker, not in Workers):

```
dependencies:
  - sharp                       — image processing (libvips binding)
  - file-type                   — MIME detection from magic bytes
  - culori                      — color space conversion (OKLCH)
  - node-vibrant                — accent color extraction
  - thumbhash                   — ThumbHash generation
  - exif-reader                 — EXIF metadata parsing
  - @mediapipe/tasks-vision     — face detection for avatar mode
```

No bundler needed — Bun runs TypeScript natively.

### Dockerfile

Multi-stage build:

**Stage 1 (builder):** `oven/bun:alpine`
- Install build dependencies for libvips (see DESIGN.md for full list: `build-base`, `meson`, `aom-dev`, `libheif-dev`, `poppler-dev`, `librsvg-dev`, `libraw-dev`, etc.)
- Either build libvips 8.18 from source or use Alpine edge package
- Install npm dependencies with `bun install`

**Stage 2 (runtime):** `oven/bun:alpine`
- Copy compiled libvips and runtime codec libraries (no `-dev` packages)
- Copy `node_modules/` from builder
- Copy application code
- `EXPOSE 8080`, `CMD ["bun", "run", "server.ts"]`

Architecture: `linux/amd64` (Cloudflare Containers requirement).

Target image size: 250–350 MB.

### container/src/server.ts

Minimal HTTP server using `Bun.serve()`:

```
POST /process
  - Read raw body as ArrayBuffer
  - Parse X-Options header (base64-encoded JSON → processing options)
  - Call pipeline.process(imageData, options) with a 60s timeout
  - Encode result as multipart/mixed response:
    Part 1: JSON (metadata, variant info without binary data)
    Part 2+: one binary part per variant (Content-Type set per variant)
  - On timeout: return 504 with PROCESSING_TIMEOUT error
  - On error: return 500 with error JSON

GET /health
  - Return 200 OK (used by Cloudflare to check container readiness)
```

### Multipart Response Format

The response uses `multipart/mixed` with a boundary string. Each part has its own `Content-Type` and a custom `X-Variant-Name` header:

```
Content-Type: multipart/mixed; boundary=----imgproc

------imgproc
Content-Type: application/json

{ "metadata": {...}, "thumbhash": "...", "variants": [...] }
------imgproc
Content-Type: image/avif
X-Variant-Name: default

<binary data>
------imgproc
Content-Type: image/avif
X-Variant-Name: thumbnail

<binary data>
------imgproc--
```

Write a `encodeMultipart(jsonPart, binaryParts[])` helper and a corresponding `parseMultipartResponse(response)` on the worker side (in `src/types.ts` or a shared utils file).

### Timeout

Wrap the `pipeline.process()` call in a `Promise.race` with a 60-second timer. If the timer wins, return `{ code: 'PROCESSING_TIMEOUT', timeout_ms: 60000 }`.

### Stub for pipeline.process()

Until spec 07 is complete, the pipeline export can be a stub:

```ts
export async function process(data: ArrayBuffer, options: unknown) {
  throw new Error('Pipeline not yet implemented');
}
```

This lets the Docker image build and the HTTP server run even before the processing logic exists.
