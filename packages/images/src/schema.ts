import type { SchemaBuilder, SchemaField, TableDefiner } from './types';

/**
 * Define the image table schema for use with @delightstack/database.
 *
 * Usage:
 *   const dbConfig = defineImageTable();
 *   // or with custom fields:
 *   const dbConfig = defineImageTable((schema) => ({
 *     user_id: schema.string(),
 *     album_id: schema.string().optional(),
 *   }));
 */
export function defineImageTable(callback?: (schema: SchemaBuilder) => Record<string, SchemaField>) {
	// This is a thin wrapper that returns a table definition compatible
	// with @delightstack/database's table() function.
	// The actual table() import and schema building happens at the call site
	// to avoid tight coupling — the consumer must have @delightstack/database installed.

	return (table: TableDefiner) => {
		return table('image', (schema: SchemaBuilder) => {
			const builtIn = {
				id: schema.string().primaryKey(),
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
			};

			const custom = callback ? callback(schema) : {};

			return { ...builtIn, ...custom };
		});
	};
}
