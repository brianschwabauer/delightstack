import type { ProcessImageOptions, ProcessImageResult, OutputVariant, VariantConfig } from './types';
import type { ImageProcessorContainer } from './container';
import { createError } from './errors';
import { generateTimestampID } from '@delightstack/utilities';

/**
 * Pre-fetch watermark images from R2 (or HTTP) before calling the container.
 * R2Bucket itself cannot cross DO RPC boundaries, so we read the bytes here
 * (where we have R2 access) and pass them through the `watermark_images`
 * option instead. Mirrors the Mode 1 (integration.ts) approach.
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

/**
 * Process an image synchronously (Mode 2: standalone, without database integration).
 *
 * Reads from R2, sends bytes to the Container DO via RPC,
 * writes variants back to R2, and returns the result.
 */
export async function processImage(
	binding: DurableObjectNamespace<ImageProcessorContainer>,
	options: ProcessImageOptions,
): Promise<ProcessImageResult> {
	// 1. Read input from R2
	const object = await options.bucket.get(options.key);
	if (!object) {
		throw createError('FILE_NOT_FOUND', { key: options.key });
	}

	// 2. Call Container DO via RPC. Pre-fetch watermark images here because
	//    R2Bucket itself can't be serialized across the DO RPC boundary —
	//    passing the bucket directly fails with DataCloneError. Mirrors the
	//    Mode 1 (integration.ts) pattern.
	const watermark_images = await prefetchWatermarkImages(options.bucket, options.variants);
	const stub = binding.getByName('image-processor') as unknown as ImageProcessorContainer;
	const result = await stub.process(await object.arrayBuffer(), {
		variants: options.variants,
		compress_original: options.compress_original ?? true,
		avatar: options.avatar,
		watermark_images,
	} as unknown as Parameters<ImageProcessorContainer['process']>[1]);

	// 3. Determine base path from key (strip the filename portion)
	const lastSlash = options.key.lastIndexOf('/');
	const basePath = lastSlash >= 0 ? options.key.slice(0, lastSlash) : options.key.replace(/\.[^.]+$/, '');

	// 4. Write variants to R2 (parallel)
	const outputVariants: OutputVariant[] = await Promise.all(
		result.variants.map(async (variant) => {
			const key = `${basePath}/${variant.name}`;

			const customMetadata: Record<string, string> = {
				width: String(variant.width),
				height: String(variant.height),
			};

			const httpMetadata: R2HTTPMetadata = {
				contentType: variant.mime_type,
				cacheControl: 'public, max-age=31536000, immutable',
			};

			if (variant.name === 'original' && result.metadata.file_name) {
				customMetadata['original-filename'] = result.metadata.file_name;
			}

			await options.bucket.put(key, variant.data, {
				httpMetadata,
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

	// 5. If keep_original is explicitly false and the original was uploaded,
	//    delete the original upload (variants were written with clean keys)
	if (options.keep_original === false) {
		await options.bucket.delete(options.key);
	}

	// 6. Return result without binary data
	return {
		ok: true,
		job_id: generateTimestampID(),
		metadata: result.metadata,
		thumbhash: result.thumbhash,
		variants: outputVariants,
	};
}
