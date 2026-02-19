# 06 — ThumbHash Generation

**Dependencies:** 01
**Files created:** `container/src/thumbhash.ts`

## Overview

Generate a ThumbHash from the image — a ~25-byte binary hash (encoded as ~33-char base64) that captures the essential colors, shapes, and aspect ratio of an image. The hash can be decoded to a ~32x32 placeholder image on any platform (including server-side) without needing the original.

## Tasks

- [x] Create `container/src/thumbhash.ts`
- [x] Implement `generateThumbHash(sharpInstance)` function
- [x] Resize image to appropriate preview size for hashing
- [x] Handle RGBA and RGB inputs correctly
- [x] Encode hash as base64 string
- [x] Handle animated images (use first frame only)
- [x] Handle images with transparency (alpha channel preserved in hash)
- [x] Unit tests with known images — verify hash is ~33 chars base64
- [x] Unit test: hash round-trips correctly (encode → decode → recognizable image)

## Details

### container/src/thumbhash.ts

```
generateThumbHash(sharpInstance): Promise<string>
```

Returns a base64-encoded ThumbHash string.

### Implementation

The `thumbhash` npm package provides `rgbaToThumbHash(width, height, rgba)`. The input must be a small RGBA image (recommended max 100x100 — the library downsamples internally but smaller input = faster).

**Steps:**

1. Resize the image to fit within 100x100 (preserving aspect ratio):

```ts
const preview = await sharp(input)
  .resize(100, 100, { fit: 'inside' })
  .ensureAlpha()  // always 4 channels (RGBA) for thumbhash
  .raw()
  .toBuffer({ resolveWithObject: true });
```

2. Generate the hash:

```ts
import { rgbaToThumbHash } from 'thumbhash';

const hash = rgbaToThumbHash(preview.info.width, preview.info.height, preview.data);
// hash is a Uint8Array (~25 bytes)
```

3. Encode as base64:

```ts
const base64 = Buffer.from(hash).toString('base64');
// ~33 characters
```

### For Animated Images

Extract the first frame before resizing:

```ts
sharp(input, { page: 0 })  // first frame only
  .resize(100, 100, { fit: 'inside' })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
```

### For Avatar Mode

When avatar mode is active, the input to ThumbHash is the already-cropped square image. The resulting hash will encode a ~1:1 aspect ratio.

### Key Properties of ThumbHash

- Encodes aspect ratio (the decoded image has the correct proportions)
- Encodes transparency (if the image has meaningful alpha)
- ~25 bytes binary / ~33 chars base64 — tiny enough to store inline in any database record
- Decodes to a ~32x32 image (dimensions vary slightly based on aspect ratio)
- Pure JS decode — works in Workers, SSR, browser, Node.js, Bun

### Testing

Test with a few known images and verify:
- Hash length is approximately 33 base64 characters (varies slightly with image complexity)
- Decoding the hash with `thumbHashToDataURL()` produces a valid `data:image/png;base64,...` URL
- The decoded image has the correct aspect ratio
- Transparent images produce hashes that decode to transparent previews
