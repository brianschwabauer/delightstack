# @delightstack/image-processor — Implementation Plan

Reference: [DESIGN.md](../DESIGN.md) contains the full design specification.

## How to Use This Plan

Read the specs in order. Each spec lists its dependencies — don't start a spec until its dependencies are complete. Within each spec, follow the task list top-to-bottom. Mark tasks `[x]` as you finish them and update the changelog below.

## Spec Index

| #  | Spec | Status | Description |
|----|------|--------|-------------|
| 01 | [Project Foundation](./01-project-foundation.md) | pending | Package scaffolding, types, error classes |
| 02 | [Docker Container Setup](./02-docker-container.md) | pending | Dockerfile, HTTP server, multipart protocol |
| 03 | [Input Validation & MIME Detection](./03-input-validation.md) | pending | File type detection, size/dimension limits |
| 04 | [Metadata Extraction & Color Analysis](./04-metadata-extraction.md) | pending | Sharp metadata, EXIF, background/accent colors, OKLCH |
| 05 | [Variant Generation](./05-variant-generation.md) | pending | Resize, format encoding, fit strategies, skipping, compressed original |
| 06 | [ThumbHash Generation](./06-thumbhash.md) | pending | ThumbHash from resized preview, base64 encoding |
| 07 | [Processing Pipeline Orchestration](./07-pipeline-orchestration.md) | pending | Wire together 03–06 for static images, result assembly |
| 08 | [Special Formats](./08-special-formats.md) | pending | Animated images, SVG sanitization, PDF rendering |
| 09 | [Container DO](./09-container-do.md) | pending | ImageProcessorContainer class, RPC bridge |
| 10 | [Standalone Mode](./10-standalone-mode.md) | pending | processImage() helper (Mode 2) |
| 11 | [Database Integration](./11-database-integration.md) | pending | defineImageTable(), imageProcessing() factory, upload, processAlarm |
| 12 | [Avatar Mode](./12-avatar-mode.md) | pending | Face detection, square crop, avatar defaults |
| 13 | [Watermarks](./13-watermarks.md) | pending | Text/image watermarks, layouts, compositing |
| 14 | [SvelteKit CDN Hook](./14-cdn-hook.md) | pending | createImageHandle(), R2 serving, ETag/304 |
| 15 | [Svelte Image Component](./15-image-component.md) | pending | Image.svelte, decodeThumbHash(), imageURL() |

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

- [ ] Complete spec 01 — Project Foundation
- [ ] Complete specs 02–06 — Container internals (parallelizable)
- [ ] Complete spec 07 — Pipeline Orchestration (integrates 03–06)
- [ ] Complete spec 08 — Special Formats
- [ ] Complete spec 09 — Container DO
- [ ] Complete specs 10–11 — Worker-side integration (parallelizable)
- [ ] Complete specs 12–13 — Advanced features (parallelizable)
- [ ] Complete spec 14 — SvelteKit CDN Hook
- [ ] Complete spec 15 — Svelte Image Component
- [ ] End-to-end integration test (Mode 1: upload → alarm → processed → CDN → component)
- [ ] End-to-end integration test (Mode 2: standalone processImage → result)
- [ ] Write package README with quickstart
- [ ] Publish dry-run (`npm pack`) to verify exports and Docker image inclusion

## Changelog

<!-- Newest entries at the top. Update this when completing a spec or making significant changes. -->

| Date | Change |
|------|--------|
| — | (no changes yet) |
