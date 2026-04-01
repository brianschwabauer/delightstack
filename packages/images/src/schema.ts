import { Database } from '@delightstack/database';

/** Extract the schema builder type from Database.table's callback parameter */
type TableCallback = Parameters<typeof Database.table>[1];
export type ImageSchemaBuilder = Parameters<TableCallback>[0];

/**
 * Define the image table schema for use with @delightstack/database.
 *
 * Usage:
 *   const imageTable = defineImageTable();
 *   // or with custom fields:
 *   const imageTable = defineImageTable((schema) => ({
 *     user_id: schema.string(),
 *     album_id: schema.string().optional(),
 *   }));
 */
export function defineImageTable(customFields?: (schema: ImageSchemaBuilder) => Record<string, any>) {
	return Database.table('image', (schema) => ({
		/** Unique identifier for the image record */
		id: schema.primaryKey(),

		/** R2 path prefix in pathname format (e.g. '/images'). Does not include the image ID. */
		base_path: schema.string(),

		/** Original filename as provided at upload (e.g. 'vacation-photo.jpg') */
		file_name: schema.string().optional(),

		/** Alt text for accessibility, stored alongside the image */
		alt_text: schema.string().optional(),

		/** Current stage in the processing pipeline */
		processing_status: schema.enum(['pending', 'processing', 'processed', 'failed']),

		/** Error code if processing failed, null on success */
		error_code: schema.enum([
			'FILE_NOT_FOUND',
			'FILE_TOO_LARGE',
			'DIMENSIONS_TOO_LARGE',
			'UNSUPPORTED_FORMAT',
			'TOO_MANY_FRAMES',
			'CORRUPTED_FILE',
			'SVG_MALICIOUS',
			'PROCESSING_TIMEOUT',
			'CONTAINER_UNAVAILABLE',
			'INTERNAL_ERROR',
		]).optional(),

		/** Detected MIME type from file magic bytes (e.g. 'image/jpeg') */
		mime_type: schema.string().optional(),

		/** Original file size in bytes */
		file_size: schema.number().int().optional(),

		/** Original width in pixels (after EXIF orientation correction) */
		width: schema.number().int().optional(),

		/** Original height in pixels (after EXIF orientation correction) */
		height: schema.number().int().optional(),

		/** Aspect ratio as width/height (e.g. 1.778 for 16:9) */
		aspect_ratio: schema.number().optional(),

		/** Whether the image has an alpha channel with non-opaque pixels */
		has_transparency: schema.boolean().optional(),

		/** Whether the image is animated (GIF, APNG, animated WebP) */
		is_animated: schema.boolean().optional(),

		/** Number of animation frames (1 for static images) */
		frame_count: schema.number().int().optional(),

		/** Average color in OKLCH, computed by resizing to 1x1 pixel */
		background_color: schema.object({
			/** Lightness (0-1) */
			l: schema.number(),
			/** Chroma (0-0.4) */
			c: schema.number(),
			/** Hue (0-360) */
			h: schema.number(),
		}).optional(),

		/** Most visually prominent/saturated color in OKLCH. Null for achromatic images. */
		accent_color: schema.object({
			/** Lightness (0-1) */
			l: schema.number(),
			/** Chroma (0-0.4) */
			c: schema.number(),
			/** Hue (0-360) */
			h: schema.number(),
		}).optional(),

		/** Average perceived brightness (0-1), the L component of background_color */
		luminance: schema.number().optional(),

		/** Date/time the photo was taken from EXIF DateTimeOriginal (ISO 8601) */
		date_taken: schema.string().datetime().optional(),

		/** GPS coordinates from EXIF data */
		gps: schema.geopoint().optional(),

		/** ThumbHash placeholder as a base64 string (~33 chars) */
		thumbhash: schema.string().base64().optional(),

		/** Generated output variants with their R2 keys and dimensions */
		variants: schema.array(schema.object({
			/** Variant name (e.g. 'default', 'thumbnail', 'original') */
			name: schema.string(),
			/** R2 key where the variant is stored (e.g. 'images/{id}/default') */
			key: schema.string(),
			/** MIME type of the encoded variant (e.g. 'image/avif') */
			mime_type: schema.string(),
			/** Width in pixels */
			width: schema.number().int(),
			/** Height in pixels */
			height: schema.number().int(),
			/** File size in bytes */
			file_size: schema.number().int(),
			/** Whether this variant is animated */
			is_animated: schema.boolean(),
			/** Resize strategy used: 'inside' (long edge) or 'cover' (short edge) */
			fit: schema.enum(['inside', 'cover']).optional(),
			/** Whether a watermark was applied to this variant */
			watermarked: schema.boolean().optional(),
		})).optional(),

		/** Internal processing state (options + retry count). Cleared after processing completes. */
		_processing: schema.string().optional(),

		// created_at and updated_at are auto-managed by DatabaseServer

		...(customFields ? customFields(schema) : {}),
	}));
}

export type ImageTable = ReturnType<typeof defineImageTable>;
