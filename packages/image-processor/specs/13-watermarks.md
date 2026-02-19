# 13 — Watermarks

**Dependencies:** 05, 07
**Files created:** `docker/watermark.ts`

## Overview

Apply watermarks to individual variants. Supports text watermarks (rendered as SVG) and image watermarks (transparent PNG/WebP logos). Three layout modes: `repeat` (tiled diagonally), `center`, and `corner`. Watermarking happens after resize but before encoding, as a compositing step in the variant generation pipeline.

## Tasks

- [x] Create `docker/watermark.ts`
- [x] Implement `applyWatermark(resizedBuffer, variantDimensions, watermarkConfig, watermarkImages)` function
- [x] Implement text watermark SVG generation (white text with black drop shadow)
- [x] Implement `repeat` layout — tiled diagonal grid
- [x] Implement `center` layout — single centered instance
- [x] Implement `corner` layout — single instance at specified corner
- [x] Apply opacity to watermark overlay
- [x] Apply rotation (per-tile for repeat, per-instance for center/corner)
- [x] Apply gap between tiles for repeat layout
- [x] Apply scale for image watermarks (relative to variant short edge)
- [x] Composite using Sharp `.composite()`
- [x] Wire into pipeline.ts — replace the stub from spec 07
- [x] Set `watermarked: true` on output variants that have watermarks
- [x] Test: text watermark with repeat layout
- [x] Test: image watermark with corner layout
- [x] Test: center layout
- [x] Test: opacity and rotation are applied correctly
- [x] Test: watermark scales proportionally across different variant sizes

## Details

### docker/watermark.ts

```
applyWatermark(
  resizedBuffer: Buffer,
  dimensions: { width: number; height: number },
  config: WatermarkConfig,
  watermarkImages?: Map<string, ArrayBuffer>,
): Promise<Buffer>
```

Returns the watermarked image as a Buffer (ready for format encoding).

### Text Watermark — SVG Generation

Generate an SVG with the watermark text rendered in white with a black drop shadow. The SVG is used as the watermark "tile" or "instance".

```ts
function createTextSvg(text: string, fontSize: number): Buffer {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${textWidth}" height="${textHeight}">
      <style>
        text {
          font-family: system-ui, -apple-system, sans-serif;
          font-size: ${fontSize}px;
          font-weight: 600;
          fill: white;
          filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.5));
        }
      </style>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">${escapeXml(text)}</text>
    </svg>
  `;
  return Buffer.from(svg);
}
```

Font size should scale with the image dimensions. A reasonable default: `fontSize = Math.max(16, Math.round(dimensions.height * 0.03))`.

Escape XML special characters in the text to prevent SVG injection.

### Image Watermark — Loading

Image watermarks arrive as pre-fetched bytes in the `watermarkImages` map (fetched by the Container DO in spec 09). Load with Sharp and resize according to the `scale` factor:

```ts
const watermarkBuffer = watermarkImages.get(config.image);
const shortEdge = Math.min(dimensions.width, dimensions.height);
const targetSize = Math.round(shortEdge * (config.scale ?? 0.25));

const watermark = await sharp(Buffer.from(watermarkBuffer))
  .resize(targetSize, targetSize, { fit: 'inside' })
  .ensureAlpha()
  .toBuffer();
```

### Layout: Repeat

Create a full-size transparent overlay with the watermark tiled diagonally:

1. Create a transparent canvas the size of the variant
2. Determine tile dimensions (watermark size + gap)
3. Apply rotation to each tile position
4. Composite all tiles onto the canvas
5. Apply opacity to the entire overlay
6. Composite the overlay onto the image

For the tiling, pre-compute a grid of positions:

```ts
const gap = config.gap ?? 64;
const rotation = config.rotation ?? -30;
const rotationRad = (rotation * Math.PI) / 180;

// Oversample positions to account for rotation
// (some positions will rotate into view from outside the canvas)
const positions: { left: number; top: number }[] = [];
const tileW = watermarkWidth + gap;
const tileH = watermarkHeight + gap;

for (let y = -dimensions.height; y < dimensions.height * 2; y += tileH) {
  for (let x = -dimensions.width; x < dimensions.width * 2; x += tileW) {
    // Apply rotation around center of canvas
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const rx = cx + (x - cx) * Math.cos(rotationRad) - (y - cy) * Math.sin(rotationRad);
    const ry = cy + (x - cx) * Math.sin(rotationRad) + (y - cy) * Math.cos(rotationRad);
    if (rx > -tileW && rx < dimensions.width + tileW && ry > -tileH && ry < dimensions.height + tileH) {
      positions.push({ left: Math.round(rx), top: Math.round(ry) });
    }
  }
}
```

An alternative (and likely simpler) approach: create a single rotated tile SVG with the text + rotation, then tile it. Sharp's `.composite()` supports a `tile: true` option, though it only tiles a single input across the full image. This may be sufficient for the repeat case:

```ts
// Create a single tile (watermark + gap padding)
const tile = await sharp(watermarkSvg)
  .resize(tileW, tileH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

// Composite with tiling
const result = await sharp(resizedBuffer)
  .composite([{ input: tile, tile: true, blend: 'over' }])
  .toBuffer();
```

Evaluate both approaches and pick the one that produces the cleanest result.

### Layout: Center

Position a single watermark instance at the center:

```ts
const result = await sharp(resizedBuffer)
  .composite([{
    input: watermarkWithOpacity,
    gravity: 'centre',
    blend: 'over',
  }])
  .toBuffer();
```

If rotation is specified, rotate the watermark before compositing.

### Layout: Corner

Position a single watermark instance at the specified corner:

```ts
const gravityMap = {
  'top-left': 'northwest',
  'top-right': 'northeast',
  'bottom-left': 'southwest',
  'bottom-right': 'southeast',
};

const result = await sharp(resizedBuffer)
  .composite([{
    input: watermarkWithOpacity,
    gravity: gravityMap[config.position ?? 'bottom-right'],
    blend: 'over',
  }])
  .toBuffer();
```

Add a small margin (e.g. 16px) so the watermark doesn't touch the edge.

### Opacity

Apply opacity by modifying the alpha channel of the watermark before compositing:

```ts
// For image watermarks: multiply alpha by opacity
const withOpacity = await sharp(watermarkBuffer)
  .ensureAlpha()
  .composite([{
    input: Buffer.from([0, 0, 0, Math.round(255 * (config.opacity ?? 0.3))]),
    raw: { width: 1, height: 1, channels: 4 },
    tile: true,
    blend: 'dest-in',  // multiply alpha channels
  }])
  .toBuffer();
```

For text watermarks, set the opacity directly in the SVG fill-opacity or in the composite blend.

### Pipeline Integration

In `pipeline.ts`, after generating each variant's resized buffer:

```ts
for (const variant of generatedVariants) {
  if (variant.config.watermark) {
    variant.data = await applyWatermark(
      variant.data,
      { width: variant.width, height: variant.height },
      variant.config.watermark,
      watermarkImages,
    );
    variant.watermarked = true;
  }
}
```

### Constraints

- Watermarks are never applied to the `original` variant
- For animated images, watermark is applied to the first frame only (limitation noted in DESIGN.md)
- Text must be XML-escaped to prevent SVG injection
