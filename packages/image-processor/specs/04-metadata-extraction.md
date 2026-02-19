# 04 — Metadata Extraction & Color Analysis

**Dependencies:** 01, 03
**Files created:** `container/src/metadata.ts`, `container/src/colors.ts`

## Overview

Extract all metadata from the original image: dimensions, color space, transparency, animation info, EXIF data (date taken, GPS), and two perceptual colors (background + accent) in OKLCH. This runs inside the container after validation passes.

## Tasks

- [x] Create `container/src/metadata.ts` — Sharp metadata + EXIF extraction
- [x] Create `container/src/colors.ts` — background color, accent color, OKLCH conversion
- [x] Extract core Sharp metadata (width, height, channels, pages, etc.)
- [x] Apply EXIF orientation correction and report corrected dimensions
- [x] Extract EXIF date_taken via exif-reader
- [x] Extract EXIF GPS coordinates and convert DMS to decimal degrees
- [x] Extract background color via 1x1 resize
- [x] Extract accent color via node-vibrant
- [x] Convert both colors to OKLCH via culori
- [x] Derive luminance from background_color.l
- [x] Generate CSS strings for both colors
- [x] Handle edge cases: no EXIF, no GPS, achromatic images (null accent)
- [x] Unit tests for metadata extraction across formats
- [x] Unit tests for color extraction (known images with predictable colors)

## Details

### container/src/metadata.ts

```
extractMetadata(sharpInstance, mimeResult, fileSize): ImageMetadata
```

**Core metadata from Sharp:**

```ts
const meta = await sharpInstance.metadata();
// meta.width, meta.height — after orientation correction if meta.orientation exists
// meta.hasAlpha — transparency
// meta.pages — frame count (1 for static, >1 for animated GIF/APNG/WebP)
// meta.space — color space string
// meta.depth — bit depth
// meta.channels — channel count
// meta.orientation — EXIF orientation (1-8)
// meta.hasProfile — ICC profile presence
// meta.density — DPI if available
```

Orientation correction: Sharp auto-rotates by default, but `metadata()` returns the *pre-rotation* dimensions when `orientation` is set. Use the orientation value to swap width/height if the orientation tag indicates rotation (values 5, 6, 7, 8).

**EXIF extraction:**

```ts
const exifBuffer = meta.exif;
if (exifBuffer) {
  const parsed = exifReader(exifBuffer);
  date_taken = parsed?.exif?.DateTimeOriginal?.toISOString() ?? null;
  // GPS: convert from DMS arrays to decimal degrees
  gps_latitude = convertGPS(parsed?.gps?.GPSLatitude, parsed?.gps?.GPSLatitudeRef);
  gps_longitude = convertGPS(parsed?.gps?.GPSLongitude, parsed?.gps?.GPSLongitudeRef);
}
```

GPS conversion helper: `[degrees, minutes, seconds]` + ref ('N'/'S'/'E'/'W') → decimal degrees. Negative for 'S' and 'W'.

**Result assembly:** Return an `ImageMetadata` object. Fields that aren't applicable (no EXIF, no GPS, etc.) are `null`.

### container/src/colors.ts

```
extractColors(sharpInstance): { background, accent, luminance, css strings }
```

**Background color — 1x1 resize method:**

```ts
const { data } = await sharp(input).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
const [r, g, b] = data;
const hex = rgbToHex(r, g, b);
const bg = oklch(parse(hex));  // culori
```

This gives the true perceptual average of all pixels (Sharp uses lanczos3 downsampling).

**Accent color — node-vibrant:**

```ts
const palette = await Vibrant.from(inputBuffer).getPalette();
const swatch = palette.Vibrant ?? palette.DarkVibrant ?? palette.LightVibrant ?? palette.Muted;
const accent = swatch ? oklch(parse(swatch.hex)) : null;
```

Fallback chain ensures we get *some* color for most images. Achromatic images (pure B&W, grayscale) may return null for all swatches — that's fine, accent_color is nullable.

**Luminance:** Just `background.l` — no extra computation.

**CSS strings:**

```ts
background_color_css = `oklch(${bg.l.toFixed(3)} ${bg.c.toFixed(3)} ${bg.h?.toFixed(1) ?? 0})`;
```

Handle the case where `h` is `undefined` (achromatic colors have no hue in OKLCH — use 0).

**Performance:** Run background and accent extraction in parallel with `Promise.all()`. The 1x1 resize is near-instant. node-vibrant takes ~50-100ms.

### Edge Cases

- **Transparent images:** The 1x1 resize ignores alpha. For images that are mostly transparent, the background color will be whatever the non-transparent pixels average to. This is usually fine.
- **Very small images (< 10px):** node-vibrant may fail or return poor results. Fall back to using the background color as the accent color.
- **CMYK images:** Sharp converts to sRGB for processing. The color extraction runs on the sRGB version.
- **HDR/wide-gamut:** If the image has a Display P3 or Adobe RGB ICC profile, Sharp's sRGB conversion may clip some colors. The extracted colors are always in sRGB-compatible OKLCH.
