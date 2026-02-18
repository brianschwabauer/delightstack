# 14 — SvelteKit CDN Hook

**Dependencies:** 11
**Files created:** `src/handle.ts`

## Overview

Implement `createImageHandle()`, a factory that returns a SvelteKit `Handle` function for serving images from R2 on your own domain. The hook intercepts requests to `/cdn/image/{id}/{variant}`, reads the R2 object, and returns it with correct headers. No database lookup needed — all serving metadata lives on the R2 object.

## Tasks

- [ ] Create `src/handle.ts`
- [ ] Implement `createImageHandle(options)` factory function
- [ ] Parse URL path into `id` and `variant` segments
- [ ] Read R2 object by key (`{prefix}/{id}/{variant}`)
- [ ] Return the object body with correct Content-Type from R2 httpMetadata
- [ ] Set Cache-Control from R2 httpMetadata (or default to immutable)
- [ ] Set ETag from R2 object
- [ ] Handle `If-None-Match` header — return 304 when ETag matches
- [ ] Expose image dimensions as `X-Image-Width` / `X-Image-Height` response headers
- [ ] Set Content-Disposition for `original` variant (download with original filename)
- [ ] Set `X-Content-Type-Options: nosniff` security header
- [ ] Return customizable SVG 404 placeholder when object not found
- [ ] 404 uses `Cache-Control: no-cache` so browser retries after processing completes
- [ ] Default variant when none specified in URL (configurable, default: `'default'`)
- [ ] Pass through non-image requests to the next handler via `resolve(event)`
- [ ] Test: serves image with correct Content-Type
- [ ] Test: returns 304 for matching ETag
- [ ] Test: returns 404 SVG placeholder for missing image
- [ ] Test: Content-Disposition on original variant
- [ ] Test: non-image paths pass through

## Details

### src/handle.ts

The full implementation is in DESIGN.md. Key points to be careful about:

**URL Parsing:**

```ts
const cdn_prefix = (options.cdn_prefix ?? '/cdn/image').replace(/\/$/, '') + '/';

// Only intercept requests under the CDN prefix
if (!event.url.pathname.startsWith(cdn_prefix)) {
  return resolve(event);
}

const path = event.url.pathname.slice(cdn_prefix.length);
const segments = path.split('/').filter(Boolean);
const id = segments[0];
const variant = segments[1] || default_variant;
const key = `${prefix}/${id}/${variant}`;
```

Validate that `id` is non-empty. Return 404 for malformed paths.

**Conditional Requests (ETag / 304):**

```ts
const ifNoneMatch = event.request.headers.get('If-None-Match');
if (ifNoneMatch) {
  const head = await bucket.head(key);
  if (head && ifNoneMatch === head.httpEtag) {
    return new Response(null, { status: 304 });
  }
}
```

Use `bucket.head()` (not `bucket.get()`) for conditional requests — it's cheaper and doesn't read the body.

**Content-Disposition for originals:**

```ts
if (variant === 'original' && object.customMetadata?.['original-filename']) {
  headers.set(
    'Content-Disposition',
    `inline; filename="${object.customMetadata['original-filename']}"`,
  );
}
```

This makes "Save Image As" in the browser use the original filename.

**404 Placeholder:**

Return an SVG with `Cache-Control: no-cache`. This is important: when an image is uploaded but not yet processed, the variant objects don't exist in R2 yet. The browser gets the SVG placeholder and, because of `no-cache`, will request again on next page load (by which time processing should be complete).

Default placeholder SVG:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#f0f0f0"/>
  <text x="200" y="158" text-anchor="middle" fill="#999"
    font-family="system-ui,sans-serif" font-size="16">Image not found</text>
</svg>
```

Customizable via the `placeholder` option.

### Options Interface

```ts
interface CreateImageHandleOptions {
  bucket: (event: RequestEvent) => R2Bucket;
  prefix?: string;           // default: 'images'
  cdn_prefix?: string;       // default: '/cdn/image'
  default_variant?: string;  // default: 'default'
  placeholder?: string;      // custom SVG string for 404s
}
```

### Security

- `X-Content-Type-Options: nosniff` prevents browsers from MIME-sniffing
- The R2 keys are deterministic (`{prefix}/{id}/{variant}`), so there's no path traversal risk unless `id` contains `/`. Consider sanitizing: reject IDs with `/` or `..`.
- The hook only reads from R2 — it cannot write or delete. It's safe to expose publicly.

### Composability

The hook returns a standard SvelteKit `Handle` function. It's used with `sequence()`:

```ts
import { sequence } from '@sveltejs/kit/hooks';
export const handle = sequence(imageHandle, authHandle, loggingHandle);
```

It must call `resolve(event)` for non-image paths so other handlers in the sequence can process them.
