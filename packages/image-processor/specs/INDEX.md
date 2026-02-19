# @delightstack/image-processor — Implementation Plan

Reference: [DESIGN.md](../DESIGN.md) contains the full design specification.

## How to Use This Plan

Read the specs in order. Each spec lists its dependencies — don't start a spec until its dependencies are complete. Within each spec, follow the task list top-to-bottom. Mark tasks `[x]` as you finish them and update the changelog below.

## Spec Index

| #  | Spec | Status | Description |
|----|------|--------|-------------|
| 01 | [Project Foundation](./01-project-foundation.md) | done | Package scaffolding, types, error classes |
| 02 | [Docker Container Setup](./02-docker-container.md) | done | Dockerfile, HTTP server, multipart protocol |
| 03 | [Input Validation & MIME Detection](./03-input-validation.md) | done | File type detection, size/dimension limits |
| 04 | [Metadata Extraction & Color Analysis](./04-metadata-extraction.md) | done | Sharp metadata, EXIF, background/accent colors, OKLCH |
| 05 | [Variant Generation](./05-variant-generation.md) | done | Resize, format encoding, fit strategies, skipping, compressed original |
| 06 | [ThumbHash Generation](./06-thumbhash.md) | done | ThumbHash from resized preview, base64 encoding |
| 07 | [Processing Pipeline Orchestration](./07-pipeline-orchestration.md) | done | Wire together 03–06 for static images, result assembly |
| 08 | [Special Formats](./08-special-formats.md) | done | Animated images, SVG sanitization, PDF rendering |
| 09 | [Container DO](./09-container-do.md) | done | ImageProcessorContainer class, RPC bridge |
| 10 | [Standalone Mode](./10-standalone-mode.md) | done | processImage() helper (Mode 2) |
| 11 | [Database Integration](./11-database-integration.md) | done | defineImageTable(), imageProcessing() factory, upload, processAlarm |
| 12 | [Avatar Mode](./12-avatar-mode.md) | done | Face detection, square crop, avatar defaults |
| 13 | [Watermarks](./13-watermarks.md) | done | Text/image watermarks, layouts, compositing |
| 14 | [SvelteKit CDN Hook](./14-cdn-hook.md) | done | createImageHandle(), R2 serving, ETag/304 |
| 15 | [Svelte Image Component](./15-image-component.md) | done | Image.svelte, decodeThumbHash(), imageURL() |

## Dependency Graph

```
01 Project Foundation
├── 02 Docker Container Setup
│   └── 07 Pipeline Orchestration ← 03, 04, 05, 06
│       ├── 08 Special Formats
│       ├── 09 Container DO
│       │   ├── 10 Standalone Mode
│       │   └── 11 Database Integration
│       │       └── 14 SvelteKit CDN Hook
│       │           └── 15 Svelte Image Component
│       ├── 12 Avatar Mode
│       └── 13 Watermarks
├── 03 Input Validation & MIME Detection
├── 04 Metadata Extraction & Color Analysis
├── 05 Variant Generation
└── 06 ThumbHash Generation
```

Specs 03–06 can be implemented in parallel once 01 is done. They converge at 07.
Specs 12 (Avatar) and 13 (Watermarks) can be done in parallel after 07.
Specs 10 and 11 can be done in parallel after 09.

## General TODO

- [x] Complete spec 01 — Project Foundation
- [x] Complete specs 02–06 — Container internals (parallelizable)
- [x] Complete spec 07 — Pipeline Orchestration (integrates 03–06)
- [x] Complete spec 08 — Special Formats
- [x] Complete spec 09 — Container DO
- [x] Complete specs 10–11 — Worker-side integration (parallelizable)
- [x] Complete specs 12–13 — Advanced features (parallelizable)
- [x] Complete spec 14 — SvelteKit CDN Hook
- [x] Complete spec 15 — Svelte Image Component
- [x] End-to-end integration test (Mode 1: upload → alarm → processed → CDN → component)
- [x] End-to-end integration test (Mode 2: standalone processImage → result)
- [ ] Write package README with quickstart
- [ ] Publish dry-run (`npm pack`) to verify exports and Docker image inclusion

## Changelog

<!-- Newest entries at the top. Update this when completing a spec or making significant changes. -->

| Date | Change |
|------|--------|
| 2026-02-18 | Tests complete — 48 tests across helpers, CDN handle, e2e Mode 1, e2e Mode 2 |
| 2026-02-18 | Spec 15 complete — Image.svelte component, decodeThumbHash(), imageURL() helpers, barrel export |
| 2026-02-18 | Spec 14 complete — createImageHandle() CDN hook with ETag/304 and SVG placeholder |
| 2026-02-18 | Specs 12–13 complete — Face-crop avatar mode, watermark compositing (text/image, repeat/center/corner) |
| 2026-02-18 | Specs 10–11 complete — processImage() standalone helper, defineImageTable(), imageProcessing() factory |
| 2026-02-18 | Spec 09 complete — ImageProcessorContainer DO with RPC, multipart parsing, watermark pre-fetch |
| 2026-02-18 | Spec 08 complete — SVG sanitization, PDF rendering, animated image support |
| 2026-02-18 | Spec 07 complete — Pipeline orchestration wiring all stages together |
| 2026-02-18 | Specs 02–06 complete — Docker container, MIME detection, validation, metadata, colors, variants, thumbhash |
| 2026-02-18 | Spec 01 complete — package.json, tsconfig.json, src/types.ts, src/errors.ts, src/index.ts |
