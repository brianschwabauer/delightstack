import type {
	VariantConfig,
	ImageProcessingOptions,
	UploadOptions,
	OutputVariant,
	ImageRecord,
	ImageMetadata,
	DatabaseLike,
} from './types';
import type { ImageProcessorContainer } from './container';
import { createError } from './errors';
import { generateTimestampID } from '@delightstack/utilities';

/** Flatten nested ImageMetadata into flat database columns */
function flattenMetadata(metadata: ImageMetadata): Record<string, unknown> {
	return {
		mime_type: metadata.mime_type ?? null,
		file_size: metadata.file_size ?? null,
		width: metadata.width ?? null,
		height: metadata.height ?? null,
		aspect_ratio: metadata.aspect_ratio ?? null,
		has_transparency: metadata.has_transparency ?? null,
		is_animated: metadata.is_animated ?? null,
		frame_count: metadata.frame_count ?? null,
		background_color_l: metadata.background_color?.l ?? null,
		background_color_c: metadata.background_color?.c ?? null,
		background_color_h: metadata.background_color?.h ?? null,
		accent_color_l: metadata.accent_color?.l ?? null,
		accent_color_c: metadata.accent_color?.c ?? null,
		accent_color_h: metadata.accent_color?.h ?? null,
		luminance: metadata.luminance ?? null,
		date_taken: metadata.date_taken ?? null,
		gps_latitude: metadata.gps_latitude ?? null,
		gps_longitude: metadata.gps_longitude ?? null,
	};
}

/**
 * Schedule an alarm using "set only if earlier" strategy.
 * Ensures we never push another alarm further into the future.
 */
async function scheduleAlarm(storage: DurableObjectStorage): Promise<void> {
	const existing = await storage.getAlarm();
	if (existing === null || Date.now() < existing) {
		await storage.setAlarm(Date.now());
	}
}

/**
 * Factory function that returns helper methods for image processing
 * integrated with @delightstack/database.
 *
 * Usage:
 *   const images = imageProcessing(db, {
 *     container: () => env.IMAGE_PROCESSOR,
 *     bucket: () => env.MEDIA_BUCKET,
 *   });
 *
 *   const record = await images.upload(file, { alt_text: 'Photo' });
 */
export function imageProcessing(
	db: DatabaseLike,
	options: ImageProcessingOptions,
) {
	const prefix = options.prefix ?? 'images';
	const defaultKeepOriginal = options.keep_original ?? true;
	const defaultCompressOriginal = options.compress_original ?? true;
	const defaultVariants = options.variants;

	return {
		/**
		 * Upload an image for processing.
		 * Creates a pending record and schedules processing via DO alarm.
		 * Returns immediately — processing happens asynchronously.
		 */
		async upload(
			data: File | Blob | ArrayBuffer | Uint8Array | ReadableStream,
			uploadOptions?: UploadOptions,
		): Promise<ImageRecord> {
			const id = generateTimestampID();
			const basePath = `${uploadOptions?.prefix ?? prefix}/${id}`;
			const r2Key = `${basePath}/original`;

			// Extract file_name from File object if available
			const file_name =
				uploadOptions?.file_name ??
				(data instanceof File ? data.name : null);

			// Write original to R2
			const bucket = options.bucket();
			const httpMetadata: R2HTTPMetadata = {
				contentType:
					data instanceof File
						? data.type
						: data instanceof Blob
							? data.type
							: 'application/octet-stream', // ArrayBuffer, Uint8Array, ReadableStream
			};
			const customMetadata: Record<string, string> = {};
			if (file_name) {
				customMetadata['original-filename'] = file_name;
			}

			await bucket.put(r2Key, data, { httpMetadata, customMetadata });

			// Create pending image record
			const now = new Date().toISOString();
			const record: ImageRecord = {
				id,
				base_path: basePath,
				file_name: file_name ?? null,
				alt_text: uploadOptions?.alt_text ?? null,
				processing_status: 'pending',
				error_code: null,
				mime_type: null,
				file_size: null,
				width: null,
				height: null,
				aspect_ratio: null,
				has_transparency: null,
				is_animated: null,
				frame_count: null,
				background_color_l: null,
				background_color_c: null,
				background_color_h: null,
				accent_color_l: null,
				accent_color_c: null,
				accent_color_h: null,
				luminance: null,
				date_taken: null,
				gps_latitude: null,
				gps_longitude: null,
				thumbhash: null,
				variants: null,
				created_at: now,
				updated_at: now,
			};

			// Store processing options on the record for processAlarm to use
			const processingOptions = {
				keep_original: uploadOptions?.keep_original ?? defaultKeepOriginal,
				compress_original: uploadOptions?.compress_original ?? defaultCompressOriginal,
				variants: uploadOptions?.variants ?? defaultVariants,
				avatar: uploadOptions?.avatar,
			};

			await db.create('image', {
				...record,
				...(uploadOptions?.data ?? {}),
				_processing_options: JSON.stringify(processingOptions),
			});

			// Schedule alarm
			await scheduleAlarm(db.ctx.storage);

			return record;
		},

		/**
		 * Process pending images. Called from the DO's alarm handler.
		 */
		async processAlarm(): Promise<void> {
			// Query pending images (also retry stuck 'processing' records from crashed runs)
			const pending = await db.query<ImageRecord & { _processing_options?: string }>(
				'image',
				`SELECT * FROM image WHERE processing_status IN ('pending', 'processing') LIMIT 10`,
			);

			if (!pending?.length) return;

			const bucket = options.bucket();
			const container = options.container();

			for (const image of pending) {
				try {
					// Mark as processing
					await db.update('image', image.id, {
						processing_status: 'processing',
						updated_at: new Date().toISOString(),
					});

					// Read original from R2
					const r2Key = `${image.base_path}/original`;
					const object = await bucket.get(r2Key);
					if (!object) {
						// Image was deleted during processing
						await db.delete('image', image.id);
						continue;
					}

					// Parse processing options
					let procOpts: {
						keep_original?: boolean;
						compress_original?: boolean;
						variants?: VariantConfig[];
						avatar?: boolean;
					} = {};
					try {
						procOpts = JSON.parse((image._processing_options as string) ?? '{}');
					} catch {
						// Use defaults
					}

					// Call Container DO via RPC
					const stub = container.getByName('image-processor') as unknown as ImageProcessorContainer;
					const result = await stub.process(await object.arrayBuffer(), {
						variants: procOpts.variants ?? defaultVariants,
						compress_original: procOpts.compress_original ?? defaultCompressOriginal,
						avatar: procOpts.avatar,
						bucket,
					});

					// Write variants to R2
					const outputVariants: OutputVariant[] = [];
					for (const variant of result.variants) {
						const key = `${image.base_path}/${variant.name}`;
						const customMetadata: Record<string, string> = {
							width: String(variant.width),
							height: String(variant.height),
						};
						if (variant.name === 'original' && image.file_name) {
							customMetadata['original-filename'] = image.file_name;
						}
						await bucket.put(key, variant.data, {
							httpMetadata: {
								contentType: variant.mime_type,
								cacheControl: 'public, max-age=31536000, immutable',
							},
							customMetadata,
						});
						outputVariants.push({
							name: variant.name,
							key,
							mime_type: variant.mime_type,
							width: variant.width,
							height: variant.height,
							file_size: variant.file_size,
							is_animated: variant.is_animated,
							fit: variant.fit,
							watermarked: variant.watermarked || undefined,
						});
					}

					// If keep_original is false, delete the raw upload
					if (procOpts.keep_original === false) {
						await bucket.delete(`${image.base_path}/original`);
					}

					// Check if image was deleted during processing
					const stillExists = await db.get<ImageRecord>('image', image.id);
					if (!stillExists) {
						// Clean up R2 objects that were just written
						const keys = outputVariants.map((v) => v.key);
						await Promise.all(keys.map((k) => bucket.delete(k)));
						continue;
					}

					// Update record to 'processed' with metadata
					const flat = flattenMetadata(result.metadata);
					await db.update('image', image.id, {
						processing_status: 'processed',
						error_code: null,
						...flat,
						thumbhash: result.thumbhash,
						variants: JSON.stringify(outputVariants),
						updated_at: new Date().toISOString(),
					});
				} catch (error: unknown) {
					// Update record to 'failed'
					const code = (error as { code?: string })?.code ?? 'INTERNAL_ERROR';
					await db.update('image', image.id, {
						processing_status: 'failed',
						error_code: code,
						updated_at: new Date().toISOString(),
					});
				}
			}

			// Reschedule if more pending/stuck
			const remaining = await db.query<{ count: number }>(
				'image',
				`SELECT COUNT(*) as count FROM image WHERE processing_status IN ('pending', 'processing')`,
			);
			if (remaining?.[0]?.count && remaining[0].count > 0) {
				await scheduleAlarm(db.ctx.storage);
			}
		},

		/**
		 * Delete an image and all its R2 objects.
		 */
		async delete(image_id: string): Promise<void> {
			const image = await db.get<ImageRecord>('image', image_id);
			if (!image) return;

			const bucket = options.bucket();

			// Delete all R2 objects under the base path
			const variants = JSON.parse(image.variants ?? '[]') as { name: string }[];
			const keys = variants.map((v) => `${image.base_path}/${v.name}`);
			keys.push(`${image.base_path}/original`);

			await Promise.all(keys.map((k) => bucket.delete(k)));

			// Delete the database record
			await db.delete('image', image_id);
		},

		/**
		 * Retry a failed image — reset to pending and schedule alarm.
		 */
		async retry(image_id: string): Promise<void> {
			await db.update('image', image_id, {
				processing_status: 'pending',
				error_code: null,
				updated_at: new Date().toISOString(),
			});
			await scheduleAlarm(db.ctx.storage);
		},

		/**
		 * Get the current status of an image.
		 */
		async getStatus(image_id: string): Promise<ImageRecord | null> {
			return db.get<ImageRecord>('image', image_id);
		},
	};
}
