import type {
	VariantConfig,
	ImageProcessingOptions,
	UploadOptions,
	OutputVariant,
	ImageRecord,
	ImageMetadata,
} from './types';
import { RESERVED_IMAGE_FIELDS } from './types';
import type { ImageProcessorContainer } from './container';
import type { DatabaseServer } from '@delightstack/database';

/** Map ImageMetadata to database record fields */
function metadataToRecord(metadata: ImageMetadata): Record<string, unknown> {
	return {
		mime_type: metadata.mime_type ?? null,
		file_size: metadata.file_size ?? null,
		width: metadata.width ?? null,
		height: metadata.height ?? null,
		aspect_ratio: metadata.aspect_ratio ?? null,
		has_transparency: metadata.has_transparency ?? null,
		is_animated: metadata.is_animated ?? null,
		frame_count: metadata.frame_count ?? null,
		background_color: metadata.background_color ?? null,
		accent_color: metadata.accent_color ?? null,
		luminance: metadata.luminance ?? null,
		date_taken: metadata.date_taken ?? null,
		gps: metadata.gps_latitude != null && metadata.gps_longitude != null
			? { lat: metadata.gps_latitude, lon: metadata.gps_longitude }
			: null,
	};
}

/**
 * Normalize a prefix string into a pathname-style base_path.
 * Always starts with '/', never ends with '/'.
 * e.g. 'images' → '/images', '/photos/' → '/photos', '' → '/'
 */
function normalizeBasePath(prefix: string): string {
	let p = prefix.startsWith('/') ? prefix : `/${prefix}`;
	if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
	return p;
}

/**
 * Construct an R2 key from a base_path, image ID, and object name.
 * base_path is a pathname like '/images', so we strip the leading '/'.
 * e.g. ('/images', 'abc', 'original') → 'images/abc/original'
 *      ('/', 'abc', 'original') → 'abc/original'
 */
function r2Key(base_path: string, id: string, name: string): string {
	const prefix = base_path === '/' ? '' : base_path.slice(1);
	return prefix ? `${prefix}/${id}/${name}` : `${id}/${name}`;
}

/**
 * Schedule an alarm for processing. Sets the alarm to now if there isn't one
 * already scheduled for the future — i.e. if no alarm exists, or the existing
 * alarm is already in the past (meaning it should fire or refire immediately).
 */
async function scheduleAlarm(storage: DurableObjectStorage): Promise<void> {
	const existing = await storage.getAlarm();
	if (existing === null || existing <= Date.now()) {
		await storage.setAlarm(Date.now());
	}
}

/**
 * Pre-fetch watermark images from R2 before calling the container.
 * R2Bucket itself cannot cross DO RPC boundaries, so we read the bytes here
 * (where we have R2 access) and pass the data through.
 */
async function prefetchWatermarkImages(
	bucket: R2Bucket,
	variants?: VariantConfig[],
): Promise<Map<string, ArrayBuffer> | undefined> {
	if (!variants?.length) return undefined;
	const image_paths = new Set<string>();
	for (const v of variants) {
		if (v.watermark?.image) image_paths.add(v.watermark.image);
	}
	if (!image_paths.size) return undefined;
	const result = new Map<string, ArrayBuffer>();
	for (const path of image_paths) {
		if (path.startsWith('http://') || path.startsWith('https://')) {
			const res = await fetch(path);
			if (res.ok) result.set(path, await res.arrayBuffer());
		} else {
			const obj = await bucket.get(path);
			if (obj) result.set(path, await obj.arrayBuffer());
		}
	}
	return result.size ? result : undefined;
}

interface ProcessingData {
	keep_original?: boolean;
	compress_original?: boolean;
	variants?: VariantConfig[];
	avatar?: boolean;
	retry_count?: number;
}

/** Parse the _processing JSON column, returning defaults on failure */
function parseProcessing(raw: string | undefined | null): ProcessingData {
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

/** Safely get a record by ID, returning null instead of throwing on 404 */
function tryGet(db: DatabaseServer<any>, entityType: string, id: string): any | null {
	try {
		return db.get(entityType, id);
	} catch (err: any) {
		if (err?.status === 404) return null;
		throw err;
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
 *     storage: this.ctx.storage,
 *   });
 *
 *   const record = await images.upload(file, { alt_text: 'Photo' });
 */
export function imageProcessing(
	db: DatabaseServer<any>,
	options: ImageProcessingOptions,
) {
	const prefix = options.prefix ?? 'images';
	const defaultKeepOriginal = options.keep_original ?? true;
	const defaultCompressOriginal = options.compress_original ?? true;
	const defaultVariants = options.variants;
	const storage = options.storage;
	const MAX_RETRIES = 5;

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
			if (uploadOptions?.data) {
				for (const key of Object.keys(uploadOptions.data)) {
					if (RESERVED_IMAGE_FIELDS.has(key as never)) {
						throw new Error(
							`Cannot use reserved field name '${key}' in uploadOptions.data. ` +
							`Reserved fields are managed by the image processor.`,
						);
					}
				}
			}

			// Extract file_name from File object if available
			const file_name =
				uploadOptions?.file_name ??
				(data instanceof File ? data.name : null);

			// Store processing options for processAlarm
			const processing = {
				keep_original: uploadOptions?.keep_original ?? defaultKeepOriginal,
				compress_original: uploadOptions?.compress_original ?? defaultCompressOriginal,
				variants: uploadOptions?.variants ?? defaultVariants,
				avatar: uploadOptions?.avatar,
			};

			// base_path is the prefix in pathname format (e.g. '/images')
			// It does NOT include the image ID — that's combined at R2 key construction time
			const basePath = normalizeBasePath(uploadOptions?.prefix ?? prefix);

			// Create pending image record (ID is auto-generated by DatabaseServer)
			const created = db.create('image', {
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
				background_color: null,
				accent_color: null,
				luminance: null,
				date_taken: null,
				gps: null,
				thumbhash: null,
				variants: null,
				_processing: JSON.stringify(processing),
				...(uploadOptions?.data ?? {}),
			} as any) as any;

			// Write original to R2
			const bucket = options.bucket();
			const originalKey = r2Key(basePath, created.id, 'original');
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

			await bucket.put(originalKey, data, { httpMetadata, customMetadata });

			// Schedule alarm
			await scheduleAlarm(storage);

			return created as ImageRecord;
		},

		/**
		 * Process pending images. Called from the DO's alarm handler.
		 */
		async processAlarm(): Promise<void> {
			type ImageRecordWithProcessing = ImageRecord & { _processing?: string };

			// Only pick up 'pending' records to avoid racing with another alarm.
			// Stuck 'processing' records are handled by the retry query below.
			const pending = db.exec(
				`SELECT * FROM image WHERE processing_status = 'pending' LIMIT 10`,
			) as unknown as ImageRecordWithProcessing[];

			if (!pending.length) {
				// Check for stuck 'processing' records and reset them to pending (with retry count)
				const stuck = db.exec(
					`SELECT * FROM image WHERE processing_status = 'processing' LIMIT 5`,
				) as unknown as ImageRecordWithProcessing[];
				if (stuck.length) {
					for (const image of stuck) {
						const proc = parseProcessing(image._processing);
						const retries = (proc.retry_count ?? 0) + 1;
						if (retries > MAX_RETRIES) {
							db.update('image', image.id, {
								processing_status: 'failed',
								error_code: 'INTERNAL_ERROR',
							} as any);
						} else {
							db.update('image', image.id, {
								processing_status: 'pending',
								_processing: JSON.stringify({ ...proc, retry_count: retries }),
							} as any);
						}
					}
					await scheduleAlarm(storage);
				}
				return;
			}

			const bucket = options.bucket();
			const container = options.container();

			for (const image of pending) {
				const proc = parseProcessing(image._processing);

				try {
					// Mark as processing atomically
					db.update('image', image.id, {
						processing_status: 'processing',
					} as any);

					// Read original from R2
					const originalKey = r2Key(image.base_path, image.id, 'original');
					const object = await bucket.get(originalKey);
					if (!object) {
						// Image was deleted during processing
						db.delete('image', image.id);
						continue;
					}

					// Call Container DO via RPC. We pre-fetch watermark images here
					// (where we have R2 access) because R2Bucket itself cannot be
					// serialized across DO RPC boundaries.
					const variants_config = proc.variants ?? defaultVariants;
					const watermark_images = await prefetchWatermarkImages(bucket, variants_config);
					const stub = container.getByName('image-processor') as unknown as ImageProcessorContainer;
					const result = await stub.process(await object.arrayBuffer(), {
						variants: variants_config,
						compress_original: proc.compress_original ?? defaultCompressOriginal,
						avatar: proc.avatar,
						watermark_images,
					} as unknown as Parameters<ImageProcessorContainer['process']>[1]);

					// Write variants to R2 (parallel)
					const outputVariants: OutputVariant[] = await Promise.all(
						result.variants.map(async (variant) => {
							const key = r2Key(image.base_path, image.id, variant.name);
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
							return {
								name: variant.name,
								key,
								mime_type: variant.mime_type,
								width: variant.width,
								height: variant.height,
								file_size: variant.file_size,
								is_animated: variant.is_animated,
								fit: variant.fit,
								watermarked: variant.watermarked || undefined,
							};
						}),
					);

					// If keep_original is false, delete the raw upload
					if (proc.keep_original === false) {
						await bucket.delete(r2Key(image.base_path, image.id, 'original'));
					}

					// Check if image was deleted during processing
					const stillExists = tryGet(db, 'image', image.id);
					if (!stillExists) {
						// Clean up R2 objects that were just written
						const keys = outputVariants.map((v) => v.key);
						await Promise.all(keys.map((k) => bucket.delete(k)));
						continue;
					}

					// Update record to 'processed' with metadata
					const fields = metadataToRecord(result.metadata);
					db.update('image', image.id, {
						processing_status: 'processed',
						error_code: null,
						...fields,
						thumbhash: result.thumbhash,
						variants: outputVariants,
						_processing: null,
					} as any);
				} catch (error: unknown) {
					// Narrow caller errors to the image error-code enum — stray error
					// codes (e.g. DelightError.unauthorized → 'unauthorized') would
					// fail enum validation when persisted on the record.
					const IMAGE_ERROR_CODES = new Set([
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
					]);
					const raw_code = (error as { code?: string })?.code;
					const code =
						raw_code && IMAGE_ERROR_CODES.has(raw_code) ? raw_code : 'INTERNAL_ERROR';
					const retries = (proc.retry_count ?? 0) + 1;
					db.update('image', image.id, {
						processing_status: retries >= MAX_RETRIES ? 'failed' : 'pending',
						error_code: code,
						_processing: JSON.stringify({ ...proc, retry_count: retries }),
					} as any);
				}
			}

			// Reschedule if more pending
			const remaining = db.exec(
				`SELECT COUNT(*) as count FROM image WHERE processing_status = 'pending'`,
			) as unknown as { count: number }[];
			if (remaining[0]?.count > 0) {
				await scheduleAlarm(storage);
			}
		},

		/**
		 * Delete an image and all its R2 objects.
		 */
		async delete(image_id: string): Promise<void> {
			const image = tryGet(db, 'image', image_id) as ImageRecord | null;
			if (!image) return;

			const bucket = options.bucket();

			// Delete all R2 objects under the image's path
			const rawVariants = image.variants;
			const variants = (
				typeof rawVariants === 'string' ? JSON.parse(rawVariants) : rawVariants ?? []
			) as { name: string }[];
			const keys = variants.map((v) => r2Key(image.base_path, image.id, v.name));
			keys.push(r2Key(image.base_path, image.id, 'original'));

			await Promise.all(keys.map((k) => bucket.delete(k)));

			// Delete the database record
			db.delete('image', image_id);
		},

		/**
		 * Retry a failed image — reset to pending and schedule alarm.
		 */
		async retry(image_id: string): Promise<void> {
			db.update('image', image_id, {
				processing_status: 'pending',
				error_code: null,
			} as any);
			await scheduleAlarm(storage);
		},

		/**
		 * Get the current status of an image.
		 */
		getStatus(image_id: string): ImageRecord | null {
			return tryGet(db, 'image', image_id) as ImageRecord | null;
		},
	};
}
