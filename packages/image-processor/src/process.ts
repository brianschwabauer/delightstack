import type { ProcessImageOptions, ProcessImageResult, OutputVariant } from './types';
import type { ImageProcessorContainer } from './container';
import { createError } from './errors';

/** Generate a unique job ID (timestamp + random) */
function generateJobId(): string {
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 8);
	return `${ts}-${rand}`;
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

	// 2. Call Container DO via RPC
	const stub = binding.getByName('image-processor') as unknown as ImageProcessorContainer;
	const result = await stub.process(await object.arrayBuffer(), {
		variants: options.variants,
		compress_original: options.compress_original ?? true,
		avatar: options.avatar,
		bucket: options.bucket, // for watermark image fetching
	});

	// 3. Determine base path from key (strip the filename)
	const basePath = options.key.replace(/\/[^/]+$/, '');

	// 4. Write variants to R2
	const outputVariants: OutputVariant[] = [];

	for (const variant of result.variants) {
		const key = `${basePath}/${variant.name}`;

		const customMetadata: Record<string, string> = {
			width: String(variant.width),
			height: String(variant.height),
		};

		// For original variant, include the original filename
		const httpMetadata: R2HTTPMetadata = {
			contentType: variant.mime_type,
			cacheControl: 'public, max-age=31536000, immutable',
		};

		// Content-Disposition for original variant (use original filename)
		if (variant.name === 'original' && result.metadata.file_name) {
			customMetadata['original-filename'] = result.metadata.file_name;
		}

		await options.bucket.put(key, variant.data, {
			httpMetadata,
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

	// 5. If keep_original is explicitly false and the original was uploaded,
	//    delete the original upload (variants were written with clean keys)
	if (options.keep_original === false) {
		await options.bucket.delete(options.key);
	}

	// 6. Return result without binary data
	return {
		ok: true,
		job_id: generateJobId(),
		metadata: result.metadata,
		thumbhash: result.thumbhash,
		variants: outputVariants,
	};
}
