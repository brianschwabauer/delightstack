# 09 — Container DO

**Dependencies:** 02, 07
**Files created:** `src/container.ts`

## Overview

Implement the `ImageProcessorContainer` class — a Cloudflare Container/Durable Object that bridges Workers to the Docker container. It exposes a `process()` method via RPC that callers use to send image bytes and receive processed results. The class is thin by design: it forwards work to the Docker container and owns no state.

## Tasks

- [x] Create `src/container.ts`
- [x] Extend `Container` from `@cloudflare/containers`
- [x] Set `defaultPort = 8080`, `sleepAfter = '5m'`, `enableInternet = false`
- [x] Implement `process(imageData, options)` RPC method
- [x] Forward image bytes + options to Docker container via `this.ctx.container.getTcpPort(8080).fetch()`
- [x] Parse multipart response from Docker container
- [x] Handle watermark image pre-fetching (resolve R2 keys/URLs to bytes before sending to container)
- [x] Handle container startup errors (CONTAINER_UNAVAILABLE)
- [x] Handle connection failures / retries
- [x] Test: RPC call with mock container
- [x] Test: Container unavailable error path

## Details

### src/container.ts

```ts
import { Container } from '@cloudflare/containers';

export class ImageProcessorContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '5m';
  enableInternet = false;

  async process(
    imageData: ArrayBuffer,
    options?: {
      variants?: VariantConfig[];
      compress_original?: boolean;
      avatar?: boolean;
      bucket?: R2Bucket;  // needed for fetching watermark images from R2
    },
  ): Promise<ContainerProcessResult> {
    // 1. Pre-fetch watermark images (if any variants have image watermarks)
    const watermarkImages = await this.fetchWatermarkImages(options);

    // 2. Build the options to send to the container
    const containerOptions = {
      variants: options?.variants,
      compress_original: options?.compress_original,
      avatar: options?.avatar,
      watermark_images: watermarkImages,  // Map<string, base64>
    };

    // 3. Send to the Docker container
    const port = this.ctx.container.getTcpPort(8080);
    const response = await port.fetch('http://localhost/process', {
      method: 'POST',
      body: imageData,
      headers: {
        'X-Options': btoa(JSON.stringify(containerOptions)),
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw createError(error.code, error.details);
    }

    // 4. Parse multipart response
    return parseMultipartResponse(response);
  }
}
```

### Watermark Image Pre-Fetching

The container has `enableInternet = false`, so it can't fetch watermark images from URLs or R2. The DO must do this before calling the container.

Scan the `variants` array for any with `watermark.image` set. For each unique watermark image path:

- If it looks like an R2 key (no protocol), read from the provided R2 bucket
- If it's a URL, fetch it (the DO has internet access)

Build a `Map<string, ArrayBuffer>` mapping image paths to their bytes. Pass this alongside the options. The container receives these bytes in the request and uses them for compositing.

```ts
private async fetchWatermarkImages(options): Promise<Map<string, ArrayBuffer> | undefined> {
  if (!options?.variants) return undefined;

  const imagePaths = new Set<string>();
  for (const v of options.variants) {
    if (v.watermark?.image) imagePaths.add(v.watermark.image);
  }
  if (imagePaths.size === 0) return undefined;

  const result = new Map<string, ArrayBuffer>();
  for (const path of imagePaths) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const res = await fetch(path);
      result.set(path, await res.arrayBuffer());
    } else if (options.bucket) {
      const obj = await options.bucket.get(path);
      if (obj) result.set(path, await obj.arrayBuffer());
    }
  }
  return result;
}
```

### Multipart Response Parsing

The container returns `multipart/mixed`. Parse it into:

- JSON part → metadata, variant info
- Binary parts → variant data (matched by `X-Variant-Name` header)

Write a `parseMultipartResponse(response)` utility. This can use the `Response` body and parse by boundary string, or use a lightweight multipart parser.

### Error Handling

- If `this.ctx.container.getTcpPort()` throws or the fetch fails with a connection error, throw `CONTAINER_UNAVAILABLE`
- If the container returns an error JSON (status >= 400), parse the error code and re-throw it using `createError()`
- If the container is starting up (cold start), the fetch may take 2-3 seconds — this is normal, not a timeout

### RPC Details

The `process()` method is automatically exposed as an RPC endpoint because it's public on the Container class. Callers use:

```ts
const stub = env.IMAGE_PROCESSOR.getByName('image-processor');
const result = await stub.process(imageData, options);
```

RPC uses Structured Clone serialization, so `ArrayBuffer` works natively. The 32 MiB RPC limit covers most images. For files larger than 32 MiB (large RAWs), the caller should pass a `ReadableStream` instead — but verify this works with the Container RPC layer, as it may require chunked transfer.

### Export

This class must be re-exported from the consumer's worker entrypoint for Cloudflare to discover it:

```ts
export { ImageProcessorContainer } from '@delightstack/images';
```
