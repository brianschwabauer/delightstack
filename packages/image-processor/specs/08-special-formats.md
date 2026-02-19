# 08 — Special Formats

**Dependencies:** 07
**Files created:** `docker/svg.ts`, `docker/pdf.ts`, animated image handling in `docker/pipeline.ts`

## Overview

Handle three categories of inputs that deviate from the standard static image pipeline: animated images (GIF, animated WebP, APNG), SVGs (vector, needs sanitization), and PDFs (rasterize first page). Each has a dedicated code path that reuses shared infrastructure (metadata, thumbhash) where possible.

## Tasks

### Animated Images
- [x] Detect animated inputs in the pipeline (metadata.pages > 1)
- [x] Force AVIF variants to fall back to animated WebP
- [x] Enforce 500-frame limit (throw `TOO_MANY_FRAMES`)
- [x] Resize all frames together (preserve timing/delays)
- [x] Generate ThumbHash from first frame only
- [x] Watermark first frame only (note in variant metadata)
- [x] Compressed original: use animated WebP (not AVIF)
- [x] Test with animated GIF, animated WebP, APNG

### SVG Handling
- [x] Create `docker/svg.ts`
- [x] Detect SVG (text-based, check for `<svg` prefix)
- [x] Parse and extract metadata (viewBox dimensions, file size)
- [x] Sanitize: strip `<script>`, event handlers (`onload`, `onerror`, etc.), external references
- [x] Detect embedded fonts, external resources
- [x] Rasterize at a sensible size for ThumbHash only (via librsvg/Sharp)
- [x] Do NOT create resized variants (SVGs are resolution-independent)
- [x] Return sanitized SVG + metadata + ThumbHash
- [x] Throw `SVG_MALICIOUS` if dangerous content is found
- [x] Test with clean SVGs, SVGs with scripts, SVGs with external references

### PDF Handling
- [x] Create `docker/pdf.ts`
- [x] Detect PDF via magic bytes (`%PDF-`)
- [x] Render first page to raster via Sharp's built-in poppler support
- [x] Use `density: 150` for quality/speed balance
- [x] Extract metadata (page count, rendered dimensions, file size)
- [x] Process rendered first page through the standard static image pipeline
- [x] Test with single-page PDF, multi-page PDF

## Details

### Animated Images

**Detection:** After loading with Sharp, check `metadata.pages`. If `> 1`, the input is animated.

**Frame limit:**

```ts
if (metadata.pages > 500) {
  throw createError('TOO_MANY_FRAMES', {
    max_frames: 500,
    actual_frames: metadata.pages,
  });
}
```

**Variant generation changes:**

- If a variant config requests `format: 'avif'`, override to `'webp'` (AVIF animation is unsupported in libvips)
- Use `sharp(input, { animated: true })` to process all frames as a unit
- Sharp's resize with `{ animated: true }` resizes every frame and preserves delay metadata

```ts
const resized = await sharp(input, { animated: true })
  .resize(maxDim, maxDim, { fit })
  .webp({ quality })
  .toBuffer({ resolveWithObject: true });
```

**ThumbHash:** Use `sharp(input, { page: 0 })` to extract the first frame, then generate ThumbHash from that.

**Compressed original:** When animated, always use WebP for the compressed original instead of AVIF.

### SVG Handling

**docker/svg.ts:**

```
svgPipeline(data: ArrayBuffer, options): ContainerProcessResult
```

**Sanitization:** Use a whitelist approach. Parse the SVG as XML and:

1. Remove all `<script>` elements
2. Remove all event handler attributes (`on*` like `onload`, `onclick`, `onerror`)
3. Remove `href`/`xlink:href` attributes pointing to external URLs (keep internal `#id` references)
4. Remove `<foreignObject>` elements (can embed arbitrary HTML)
5. Remove `<iframe>`, `<embed>`, `<object>` elements
6. Keep everything else (paths, shapes, text, gradients, filters, animations, embedded images)

If the SVG contains `javascript:` URLs or `data:text/html` content, throw `SVG_MALICIOUS`.

Consider using DOMPurify (it works in Bun) or a custom lightweight sanitizer. DOMPurify is battle-tested but heavy — evaluate the trade-off.

**Metadata extraction:**

```ts
// Parse viewBox for dimensions
const viewBoxMatch = svgString.match(/viewBox="([^"]+)"/);
const [, , width, height] = viewBoxMatch[1].split(/\s+/).map(Number);
// Also check width/height attributes as fallback
```

**Rasterization for ThumbHash:**

```ts
const rasterized = await sharp(Buffer.from(sanitizedSvg))
  .resize(100, 100, { fit: 'inside' })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
```

**No resized variants.** SVGs are resolution-independent. The result includes the sanitized SVG as the only "variant" (with `name: 'original'`).

### PDF Handling

**docker/pdf.ts:**

```
pdfPipeline(data: ArrayBuffer, options): ContainerProcessResult
```

**First page rendering:**

```ts
const rendered = sharp(Buffer.from(data), {
  density: 150,  // DPI for rasterization
  page: 0,       // first page only
});
```

Sharp uses poppler internally for PDF rendering (requires `poppler-dev` in the Docker image).

**Metadata:** Extract page count from poppler. The rendered dimensions come from Sharp metadata after rasterization.

**Processing:** Once rasterized to a bitmap, feed into the standard static image pipeline — extract metadata, colors, generate variants, ThumbHash. The result metadata should note `mime_type: 'application/pdf'` (the original format) even though variants are raster images.

**Page count:** If possible, extract total page count from the PDF without rendering all pages. poppler's `pdfinfo` equivalent or parsing the PDF trailer can provide this. Store as `metadata.format_info.page_count`.
