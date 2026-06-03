import sharp from 'sharp';
import { detectMimeType } from './mime';
import { validateInput } from './validation';
import { extractMetadata, type MetadataResult } from './metadata';
import { extractColors, type ColorResult } from './colors';
import {
	resizeVariants,
	encodeVariant,
	generateCompressedOriginal,
	resolveConfigs,
	type VariantConfig,
	type WatermarkConfig,
	type GeneratedVariant,
	type ResizedVariant,
} from './variants';
import { generateThumbHash } from './thumbhash';
import { svgPipeline } from './svg';
import { pdfPipeline } from './pdf';
import { faceCrop, AVATAR_DEFAULTS } from './face-crop';
import { applyWatermarkToVariant } from './watermark';

export interface ProcessOptions {
	variants?: VariantConfig[];
	compress_original?: boolean;
	keep_original?: boolean;
	avatar?: boolean;
	watermark_images?: Map<string, ArrayBuffer>;
	file_name?: string;
}

export interface PipelineResult {
	metadata: MetadataResult & ColorResult;
	thumbhash: string;
	variants: GeneratedVariant[];
}

/**
 * Main processing pipeline entry point.
 * Called by the HTTP server with raw image bytes and options.
 */
export async function process(
	data: ArrayBuffer,
	options: ProcessOptions,
): Promise<PipelineResult> {
	// 1. Detect MIME type
	const mimeResult = await detectMimeType(data);
	if (!mimeResult) {
		throw Object.assign(new Error('Could not detect file type'), {
			code: 'UNSUPPORTED_FORMAT',
			details: { mime_type: 'unknown', file_extension: 'unknown' },
		});
	}

	// 2. Validate input
	validateInput(data, mimeResult);

	// 3. Route by format
	if (mimeResult.mime_type === 'image/svg+xml') {
		return svgPipeline(data, options);
	}
	if (mimeResult.mime_type === 'application/pdf') {
		return pdfPipeline(data, options);
	}

	// 4. Standard image pipeline
	return imagePipeline(data, mimeResult, options);
}

/** Generate variants for animated images, preserving all frames */
async function generateAnimatedVariants(
	input: Buffer,
	metadata: MetadataResult,
	configs: VariantConfig[],
	options: {
		compress_original: boolean;
		keep_original: boolean;
		watermark_images?: Map<string, ArrayBuffer>;
	},
): Promise<GeneratedVariant[]> {
	const longEdge = Math.max(metadata.width, metadata.height);
	const results: GeneratedVariant[] = [];

	for (const config of configs) {
		const fit = config.fit ?? (config.max_dimension > 1024 ? 'inside' : 'cover');
		const sharpFit: 'inside' | 'outside' = fit === 'inside' ? 'inside' : 'outside';
		const maxDim = config.max_dimension;
		const quality = config.quality ?? 75; // WebP default for animated
		const needsResize = longEdge >= maxDim;

		// Resize animated (preserving all frames), or just re-encode at original size
		const pipeline = sharp(input, { animated: true });
		if (needsResize) {
			pipeline.resize(maxDim, maxDim, { fit: sharpFit, withoutEnlargement: true });
		}
		const resized = await pipeline.toBuffer({ resolveWithObject: true });

		const outMeta = await sharp(resized.data, { animated: true }).metadata();
		const height = outMeta.pageHeight ?? resized.info.height;
		const hasWatermark = config.watermark && config.name !== 'original';

		let finalData: Buffer;
		if (hasWatermark) {
			// For animated watermarks: extract first frame, watermark it,
			// then composite the watermarked first frame back onto the animation
			const firstFrame = await sharp(resized.data, { page: 0 }).png().toBuffer();
			const watermarkedFrame = await applyWatermarkToVariant(
				firstFrame,
				{ width: resized.info.width, height },
				config.watermark!,
				options.watermark_images,
			);
			// Re-encode with watermarked first frame composited
			finalData = await sharp(resized.data, { animated: true })
				.composite([
					{ input: watermarkedFrame, tile: false, blend: 'over', gravity: 'northwest' },
				])
				.webp({ quality })
				.toBuffer();
		} else {
			finalData = await sharp(resized.data, { animated: true })
				.webp({ quality })
				.toBuffer();
		}

		results.push({
			name: config.name,
			data: finalData,
			width: resized.info.width,
			height,
			mime_type: 'image/webp',
			file_size: finalData.byteLength,
			is_animated: true,
			fit,
			watermarked: !!hasWatermark,
		});
	}

	// Compressed original for animated: always WebP
	if (options.compress_original && options.keep_original) {
		const compressed = await sharp(input, { animated: true })
			.keepMetadata()
			.webp({ quality: 75 })
			.toBuffer({ resolveWithObject: true });

		const outMeta = await sharp(compressed.data, { animated: true }).metadata();
		const height = outMeta.pageHeight ?? compressed.info.height;

		results.push({
			name: 'original',
			data: compressed.data,
			width: compressed.info.width,
			height,
			mime_type: 'image/webp',
			file_size: compressed.data.byteLength,
			is_animated: true,
			watermarked: false,
		});
	}

	return results;
}

async function imagePipeline(
	data: ArrayBuffer,
	mimeResult: { mime_type: string; extension: string },
	options: ProcessOptions,
): Promise<PipelineResult> {
	const inputBuffer = Buffer.from(data);

	// Decode and check for animation (also detects corrupt files)
	let sharpMeta;
	try {
		sharpMeta = await sharp(inputBuffer).metadata();
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		throw Object.assign(new Error('File appears to be corrupt or truncated'), {
			code: 'CORRUPTED_FILE',
			details: { message },
		});
	}
	const pages = sharpMeta.pages ?? 1;
	const is_animated = pages > 1;

	// Enforce frame limit for animated images
	if (is_animated && pages > 500) {
		throw Object.assign(new Error('Too many animation frames'), {
			code: 'TOO_MANY_FRAMES',
			details: { max_frames: 500, actual_frames: pages },
		});
	}

	// For metadata/color extraction, use first frame
	const processBuffer = is_animated
		? await sharp(inputBuffer, { page: 0 }).toBuffer()
		: inputBuffer;

	// Extract metadata
	const coreMetadata = await extractMetadata(
		processBuffer,
		mimeResult,
		data.byteLength,
		options.file_name ?? null,
	);

	// If animated, override the animation fields from the original
	if (is_animated) {
		coreMetadata.is_animated = true;
		coreMetadata.frame_count = pages;
		if (sharpMeta.pageHeight) {
			coreMetadata.height = sharpMeta.pageHeight;
		}
	}

	// Run colors and avatar crop in parallel
	let workingBuffer = processBuffer;
	const [colors] = await Promise.all([
		extractColors(processBuffer),
		(async () => {
			if (options.avatar) {
				workingBuffer = await faceCrop(processBuffer, coreMetadata);
			}
		})(),
	]);

	// Apply avatar defaults if avatar mode is active
	const avatarActive = options.avatar === true;
	const effectiveVariants =
		options.variants ?? (avatarActive ? AVATAR_DEFAULTS.variants : undefined);
	const keep_original =
		options.keep_original ?? (avatarActive ? AVATAR_DEFAULTS.keep_original : true);
	const compress_original =
		options.compress_original ??
		(avatarActive ? AVATAR_DEFAULTS.compress_original : true);

	// Resolve variant configs
	const resolvedConfigs = resolveConfigs(effectiveVariants);

	// For animated images, override AVIF → WebP (AVIF animation unsupported in libvips)
	if (is_animated) {
		for (const config of resolvedConfigs) {
			if (config.format === 'avif') {
				config.format = 'webp';
				// Adjust quality for WebP (AVIF 50 ≈ WebP 75)
				if (!config.quality || config.quality <= 50) {
					config.quality = 75;
				}
			}
		}
	}

	// Generate variants and thumbhash
	const variantBuffer = is_animated ? inputBuffer : workingBuffer;

	if (is_animated) {
		const [variants, thumbhash] = await Promise.all([
			generateAnimatedVariants(variantBuffer, coreMetadata, resolvedConfigs, {
				compress_original,
				keep_original,
				watermark_images: options.watermark_images,
			}),
			generateThumbHash(workingBuffer, is_animated),
		]);

		return {
			metadata: { ...coreMetadata, ...colors },
			thumbhash,
			variants,
		};
	}

	// Static pipeline: resize → watermark → encode
	const [resized, thumbhash] = await Promise.all([
		resizeVariants(workingBuffer, coreMetadata, resolvedConfigs),
		generateThumbHash(workingBuffer, false),
	]);

	const variants: GeneratedVariant[] = [];
	for (const r of resized) {
		const config = resolvedConfigs.find((c) => c.name === r.name);
		if (config?.watermark && r.name !== 'original') {
			// Apply watermark to raw resized buffer, then encode
			const watermarkedData = await applyWatermarkToVariant(
				r.raw_data,
				{ width: r.width, height: r.height },
				config.watermark!,
				options.watermark_images,
			);
			// Replace raw_data and encode
			variants.push(await encodeVariant({ ...r, raw_data: watermarkedData }, true));
		} else {
			variants.push(await encodeVariant(r, false));
		}
	}

	// Compressed original
	if (compress_original && keep_original) {
		variants.push(await generateCompressedOriginal(workingBuffer, false));
	}

	return {
		metadata: { ...coreMetadata, ...colors },
		thumbhash,
		variants,
	};
}
