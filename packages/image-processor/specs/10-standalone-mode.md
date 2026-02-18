# 10 — Standalone Mode

**Dependencies:** 09
**Files created:** `src/process.ts`

## Overview

Implement the `processImage()` helper function for Mode 2 (standalone, without `@delightstack/database`). This is a synchronous, blocking call: the worker reads from R2, sends bytes to the Container DO via RPC, writes variants back to R2, and returns the result. The caller waits for the entire process to complete.

## Tasks

- [ ] Create `src/process.ts`
- [ ] Implement `processImage(binding, options)` function
- [ ] Read input file from R2 bucket
- [ ] Call Container DO via RPC with image bytes + processing options
- [ ] Write variants back to R2 (extensionless keys)
- [ ] Write compressed original to R2 (if applicable)
- [ ] Set correct R2 metadata on all written objects (Content-Type, Cache-Control, dimensions)
- [ ] Strip binary data from result before returning (caller doesn't need buffers)
- [ ] Handle FILE_NOT_FOUND (R2 key doesn't exist)
- [ ] Pass R2 bucket through to container DO for watermark image fetching
- [ ] Test: end-to-end with mock container + R2
- [ ] Test: FILE_NOT_FOUND error path
- [ ] Test: variant skipping — only written variants appear in result

## Details

### src/process.ts

```ts
export async function processImage(
  binding: DurableObjectNamespace<ImageProcessorContainer>,
  options: ProcessImageOptions,
): Promise<ProcessImageResult> {
  // 1. Read input from R2
  const object = await options.bucket.get(options.key);
  if (!object) {
    throw createError('FILE_NOT_FOUND', { key: options.key });
  }

  // 2. Call Container DO via RPC
  const stub = binding.getByName('image-processor');
  const result = await stub.process(await object.arrayBuffer(), {
    variants: options.variants,
    compress_original: options.compress_original ?? true,
    avatar: options.avatar,
    bucket: options.bucket,  // for watermark image fetching
  });

  // 3. Determine base path from key (strip the filename)
  //    e.g. 'uploads/photo.jpg' → 'uploads'
  //    The caller controls the key structure.
  const basePath = options.key.replace(/\/[^/]+$/, '');

  // 4. Write variants to R2
  for (const variant of result.variants) {
    await options.bucket.put(
      `${basePath}/${variant.name}`,
      variant.data,
      {
        httpMetadata: {
          contentType: variant.mime_type,
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: {
          width: String(variant.width),
          height: String(variant.height),
        },
      },
    );
  }

  // 5. Handle compressed original
  if (result.compressed_original && options.keep_original !== false) {
    await options.bucket.put(
      `${basePath}/original`,
      result.compressed_original.data,
      {
        httpMetadata: {
          contentType: result.compressed_original.mime_type,
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: {
          width: String(result.compressed_original.width),
          height: String(result.compressed_original.height),
        },
      },
    );
  }

  // 6. Return result without binary data
  return {
    ok: true,
    job_id: generateJobId(),
    metadata: result.metadata,
    thumbhash: result.thumbhash,
    variants: result.variants.map(v => ({
      name: v.name,
      key: `${basePath}/${v.name}`,
      mime_type: v.mime_type,
      width: v.width,
      height: v.height,
      file_size: v.file_size,
      is_animated: v.is_animated,
      fit: v.fit,
      watermarked: v.watermarked,
    })),
  };
}
```

### Key Design Points

**Base path derivation:** In standalone mode, the caller provides the full R2 key (e.g. `uploads/photo.jpg`). Variants are written alongside it by stripping the filename and appending the variant name. This is a simple convention — the caller controls the namespace.

**No database interaction.** This function is purely R2 + Container DO. The caller manages their own state. The returned `ProcessImageResult` has everything needed to build a database record or API response.

**Synchronous.** Workers have no wall-clock time limit. The `await stub.process()` call is I/O wait (not CPU time), so waiting 2-30 seconds is fine.

**R2 writes are sequential.** Each variant is written one at a time. For most images (2-3 variants), this adds ~100-200ms total. Parallelizing is possible but adds complexity for marginal gain.

### R2 Object Metadata

Every object written to R2 carries enough metadata to be served directly by the CDN hook (spec 14) without a database lookup:

| Metadata | Value |
|----------|-------|
| `httpMetadata.contentType` | The variant's MIME type (e.g. `image/avif`) |
| `httpMetadata.cacheControl` | `public, max-age=31536000, immutable` |
| `customMetadata.width` | String pixel width |
| `customMetadata.height` | String pixel height |
