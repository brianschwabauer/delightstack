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
		id: schema.primaryKey(),
		base_path: schema.string(),
		file_name: schema.string().optional(),
		alt_text: schema.string().optional(),
		processing_status: schema.string(), // 'pending' | 'processing' | 'processed' | 'failed'
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
		variants: schema.string().optional(), // JSON string of variant info
		_processing: schema.string().optional(), // JSON: processing options + retry state
		created_at: schema.string(),
		updated_at: schema.string(),
		...(customFields ? customFields(schema) : {}),
	}));
}

export type ImageTable = ReturnType<typeof defineImageTable>;
