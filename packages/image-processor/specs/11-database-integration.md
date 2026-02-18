# 11 — Database Integration

**Dependencies:** 09
**Files created:** `src/schema.ts`, `src/integration.ts`

## Overview

Implement the `@delightstack/database` integration: `defineImageTable()` for schema definition and `imageProcessing()` for the factory that provides `upload()`, `delete()`, `retry()`, `getStatus()`, and `processAlarm()`. This is Mode 1 — the recommended way to use the package. Upload returns immediately; processing happens asynchronously via DO alarms.

## Tasks

### defineImageTable()
- [ ] Create `src/schema.ts`
- [ ] Implement `defineImageTable(callback?)` using `@delightstack/database` table builder
- [ ] Define all built-in columns (id, base_path, file_name, alt_text, processing_status, error_code, all metadata columns, thumbhash, variants, created_at, updated_at)
- [ ] Support optional callback for custom fields: `defineImageTable((schema) => ({ user_id: schema.string() }))`
- [ ] Merge custom fields with built-in fields
- [ ] Verify type inference flows through to `db.create()`, `db.get()`, etc.
- [ ] Test: basic table without custom fields
- [ ] Test: table with custom fields — types are correct

### imageProcessing() Factory
- [ ] Create `src/integration.ts`
- [ ] Implement `imageProcessing(db, options)` — returns helper object
- [ ] Accept `container` and `bucket` as lazy getters (functions, not values)
- [ ] Accept optional `keep_original`, `compress_original`, `variants` defaults

### upload()
- [ ] Generate timestamp-based unique ID
- [ ] Extract file_name from File object (or use options.file_name)
- [ ] Write original to R2 at `{prefix}/{id}/original` with httpMetadata and customMetadata
- [ ] Create pending image record with `db.create('image', {..., ...options.data})`
- [ ] Schedule alarm using "set only if earlier" strategy
- [ ] Return the image record immediately

### processAlarm()
- [ ] Query pending images: `SELECT * FROM image WHERE processing_status = 'pending' LIMIT 10`
- [ ] For each pending image:
  - Mark as `'processing'`
  - Read original from R2
  - Call Container DO via RPC (pass variant configs, compress_original, avatar)
  - Check if image was deleted during processing (handle cleanup)
  - Write variants to R2
  - Write compressed original to R2 (if applicable)
  - Update record to `'processed'` with all metadata
  - On error: update record to `'failed'` with error_code
- [ ] Reschedule alarm if more pending images remain
- [ ] Handle "set only if earlier" alarm scheduling correctly

### delete()
- [ ] Delete image record from database
- [ ] Delete all R2 objects under `{base_path}/` (original + all variants)
- [ ] Handle case where image is currently being processed (processAlarm detects deletion and cleans up)

### retry()
- [ ] Reset processing_status from `'failed'` to `'pending'`
- [ ] Clear error_code
- [ ] Schedule alarm

### getStatus()
- [ ] Return the image record via `db.get('image', id)`

### Tests
- [ ] Test: upload creates record + R2 object + schedules alarm
- [ ] Test: processAlarm processes pending images end-to-end
- [ ] Test: processAlarm handles deletion during processing
- [ ] Test: processAlarm reschedules when more pending
- [ ] Test: processAlarm does nothing when no pending
- [ ] Test: delete cleans up R2 objects
- [ ] Test: retry resets failed image to pending
- [ ] Test: custom fields flow through upload → record

## Details

### src/schema.ts

```ts
import { table } from '@delightstack/database';

export function defineImageTable(
  callback?: (schema: DatabaseGenerator) => Record<string, FieldDefinition>
) {
  return table('image', (schema) => {
    const builtIn = {
      id: schema.string().primaryKey(),
      base_path: schema.string(),
      file_name: schema.string().optional(),
      alt_text: schema.string().optional(),
      processing_status: schema.string(),  // 'pending' | 'processing' | 'processed' | 'failed'
      error_code: schema.string().optional(),
      mime_type: schema.string().optional(),
      file_size: schema.number().optional(),
      width: schema.number().optional(),
      height: schema.number().optional(),
      aspect_ratio: schema.number().optional(),
      has_transparency: schema.boolean().optional(),
      is_animated: schema.boolean().optional(),
      frame_count: schema.number().optional(),
      background_color_l: schema.number().optional(),
      background_color_c: schema.number().optional(),
      background_color_h: schema.number().optional(),
      accent_color_l: schema.number().optional(),
      accent_color_c: schema.number().optional(),
      accent_color_h: schema.number().optional(),
      luminance: schema.number().optional(),
      date_taken: schema.string().optional(),
      gps_latitude: schema.number().optional(),
      gps_longitude: schema.number().optional(),
      thumbhash: schema.string().optional(),
      variants: schema.string().optional(),  // JSON string of variant info
    };

    const custom = callback ? callback(schema) : {};

    return { ...builtIn, ...custom };
  });
}
```

The return type must flow through so that `db.create('image', {...})` has correct types for both built-in and custom fields.

### src/integration.ts

```ts
interface ImageProcessingOptions {
  container: () => DurableObjectNamespace<ImageProcessorContainer>;
  bucket: () => R2Bucket;
  keep_original?: boolean;        // default: true
  compress_original?: boolean;    // default: true
  variants?: VariantConfig[];     // default: standard default + thumbnail
  prefix?: string;                // default: 'images'
}

export function imageProcessing(
  db: DatabaseServer,
  options: ImageProcessingOptions,
): ImageProcessingHelper {
  return {
    async upload(data, uploadOptions) { ... },
    delete(image_id) { ... },
    retry(image_id) { ... },
    getStatus(image_id) { ... },
    async processAlarm() { ... },
  };
}
```

### Alarm Scheduling — "Set Only If Earlier"

Both `upload()` and `processAlarm()` use this pattern:

```ts
const existing = await db.ctx.storage.getAlarm();
if (existing === null || Date.now() < existing) {
  await db.ctx.storage.setAlarm(Date.now());
}
```

This ensures:
- If no alarm exists, set one for now
- If an alarm exists for later, move it to now (so images process sooner)
- If an alarm already exists for now or earlier, leave it alone
- Other code's alarms are never pushed further into the future

### R2 Deletion on delete()

When deleting an image, list all objects under `{base_path}/` and delete them:

```ts
// R2 doesn't have a "delete prefix" API, so list + delete
const listed = await bucket.list({ prefix: `${image.base_path}/` });
await Promise.all(listed.objects.map(obj => bucket.delete(obj.key)));
```

Alternatively, since we know the variant names from the record, delete them explicitly:

```ts
const variants = JSON.parse(image.variants ?? '[]');
const keys = variants.map(v => `${image.base_path}/${v.name}`);
if (image.processing_status !== 'pending') {
  keys.push(`${image.base_path}/original`);  // may or may not exist
}
await Promise.all(keys.map(k => bucket.delete(k)));
```

The second approach avoids a list operation but requires the variants to be stored in the record.

### Metadata Mapping

The container returns `ImageMetadata` with nested objects (e.g. `background_color: { l, c, h }`). The database stores these as flat columns (`background_color_l`, `background_color_c`, `background_color_h`). The `processAlarm()` handler must flatten the metadata before calling `db.update()`:

```ts
const flat = {
  mime_type: metadata.mime_type,
  width: metadata.width,
  height: metadata.height,
  aspect_ratio: metadata.aspect_ratio,
  // ... other direct mappings
  background_color_l: metadata.background_color.l,
  background_color_c: metadata.background_color.c,
  background_color_h: metadata.background_color.h,
  accent_color_l: metadata.accent_color?.l ?? null,
  accent_color_c: metadata.accent_color?.c ?? null,
  accent_color_h: metadata.accent_color?.h ?? null,
  luminance: metadata.luminance,
  // ...
};
```

Write a `flattenMetadata(metadata: ImageMetadata)` helper to keep this mapping in one place.
