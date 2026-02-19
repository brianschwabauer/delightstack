# 12 — Avatar Mode

**Dependencies:** 07
**Files created:** `container/src/face-crop.ts`

## Overview

Implement face-aware square cropping for avatar/profile pictures. When `avatar: true` is set, the pipeline detects faces using MediaPipe's BlazeFace model, crops to a square centered on the largest face, and falls back to Sharp's attention-based crop if no face is detected. The crop happens *before* variant generation so all variants receive the already-cropped square.

## Tasks

- [x] Create `container/src/face-crop.ts`
- [x] Install and configure `@mediapipe/tasks-vision` with BlazeFace short-range model
- [x] Load the face detection model once at container startup (reuse across requests)
- [x] Implement face detection on input image
- [x] Compute bounding box center of the largest detected face
- [x] Expand to a square crop region centered on the face
- [x] Clamp crop region to image bounds (handle faces near edges)
- [x] Extract square region with Sharp `.extract()`
- [x] Implement fallback: Sharp attention-based crop when no face is detected
- [x] Apply avatar defaults (keep_original: false, single 640px thumbnail variant)
- [x] Allow explicit overrides (avatar: true + keep_original: true should work)
- [x] Wire into pipeline.ts — replace the stub from spec 07
- [x] Test: image with one centered face
- [x] Test: image with multiple faces (should use largest)
- [x] Test: image with no face (should fall back to attention crop)
- [x] Test: image with face near edge (crop should clamp to bounds)
- [x] Test: avatar defaults are applied correctly
- [x] Test: avatar defaults can be overridden

## Details

### container/src/face-crop.ts

```
faceCrop(sharpInstance, metadata): Promise<Sharp>
```

Returns a new Sharp instance loaded with the cropped square image.

### Face Detection Setup

Load the BlazeFace short-range model at container startup:

```ts
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

let detector: FaceDetector;

export async function initFaceDetector() {
  const vision = await FilesetResolver.forVisionTasks(
    'node_modules/@mediapipe/tasks-vision/wasm'
  );
  detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'path/to/blaze_face_short_range.tflite',
    },
    runningMode: 'IMAGE',
  });
}
```

Call `initFaceDetector()` once in `server.ts` at startup. The model is ~200 KB and loads in <100ms.

Note: Verify that `@mediapipe/tasks-vision` works in Bun. If not, consider alternatives:
- `@vladmandic/face-api` (works in Node/Bun, TensorFlow.js based)
- Run MediaPipe via WASM directly
- Use Sharp's built-in attention detection as the primary strategy (less accurate but no extra deps)

### Face Detection

```ts
export async function faceCrop(
  sharpInstance: Sharp,
  metadata: ImageMetadata,
): Promise<Sharp> {
  // 1. Get raw pixel data for face detection
  //    Resize to max 1024px for faster detection (face detection doesn't need full resolution)
  const preview = await sharpInstance
    .clone()
    .resize(1024, 1024, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const scaleX = metadata.width / preview.info.width;
  const scaleY = metadata.height / preview.info.height;

  // 2. Run face detection
  const result = detector.detect({
    data: new Uint8ClampedArray(preview.data),
    width: preview.info.width,
    height: preview.info.height,
  });

  if (result.detections.length === 0) {
    // No face → fallback to attention-based crop
    return fallbackCrop(sharpInstance, metadata);
  }

  // 3. Find the largest face (by bounding box area)
  const largest = result.detections.reduce((a, b) => {
    const areaA = a.boundingBox.width * a.boundingBox.height;
    const areaB = b.boundingBox.width * b.boundingBox.height;
    return areaA > areaB ? a : b;
  });

  // 4. Scale bounding box back to original image coordinates
  const faceCenter = {
    x: (largest.boundingBox.originX + largest.boundingBox.width / 2) * scaleX,
    y: (largest.boundingBox.originY + largest.boundingBox.height / 2) * scaleY,
  };

  // 5. Compute square crop region centered on face
  const squareSide = Math.min(metadata.width, metadata.height);
  let left = Math.round(faceCenter.x - squareSide / 2);
  let top = Math.round(faceCenter.y - squareSide / 2);

  // 6. Clamp to image bounds
  left = Math.max(0, Math.min(left, metadata.width - squareSide));
  top = Math.max(0, Math.min(top, metadata.height - squareSide));

  // 7. Extract square region
  return sharp(await sharpInstance.toBuffer()).extract({
    left,
    top,
    width: squareSide,
    height: squareSide,
  });
}
```

### Fallback: Attention-Based Crop

When no face is detected, use Sharp's built-in saliency detection:

```ts
function fallbackCrop(sharpInstance: Sharp, metadata: ImageMetadata): Sharp {
  const size = Math.min(metadata.width, metadata.height);
  return sharpInstance.resize(size, size, {
    fit: 'cover',
    position: 'attention',  // uses entropy/saliency to find the most interesting region
  });
}
```

### Avatar Defaults

In the pipeline, when `avatar: true`:

```ts
const avatarDefaults = {
  keep_original: false,
  compress_original: false,  // n/a since keep_original is false
  variants: [
    { name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4, fit: 'inside' },
  ],
};
```

Explicit options override these defaults. For example, `{ avatar: true, keep_original: true }` keeps the pre-crop original.

The `fit: 'inside'` makes no difference for avatar variants because the input is already square after cropping — both `inside` and `cover` produce the same result on a square.

### Performance

Face detection on a 1024px preview: ~50-100ms on a 0.5 vCPU container. The Sharp extract operation is near-instant. Total avatar overhead: ~100ms compared to a normal upload.
