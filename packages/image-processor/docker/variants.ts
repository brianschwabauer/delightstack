import sharp from 'sharp';
import type { MetadataResult } from './metadata';

export interface VariantConfig {
	name: string;
	max_dimension: number;
	format: 'avif' | 'webp' | 'jpeg' | 'png';
	quality?: number;
	effort?: number;
	fit?: 'inside' | 'cover';
	watermark?: unknown;
}

export interface GeneratedVariant {
	name: string;
	data: Buffer;
	width: number;
	height: number;
	mime_type: string;
	file_size: number;
	is_animated: boolean;
	fit: 'inside' | 'cover';
	watermarked: boolean;
}

const DEFAULT_VARIANTS: VariantConfig[] = [
	{ name: 'default', max_dimension: 2048, format: 'avif', quality: 50, effort: 4 },
	{ name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4 },
];

const FORMAT_MIME: Record<string, string> = {
	avif: 'image/avif',
	webp: 'image/webp',
	jpeg: 'image/jpeg',
	png: 'image/png',
};

const DEFAULT_QUALITY: Record<string, number> = {
	avif: 50,
	webp: 75,
	jpeg: 80,
};

/**
 * Generate resized output variants from the source image.
 * Handles fit strategies, format encoding, quality, variant skipping, and compressed original.
 */
export async function generateVariants(
	input: Buffer,
	metadata: MetadataResult,
	configs: VariantConfig[] | undefined,
	options: { compress_original: boolean; keep_original: boolean },
): Promise<GeneratedVariant[]> {
	const resolvedConfigs = configs?.length ? configs : DEFAULT_VARIANTS;
	const longEdge = Math.max(metadata.width, metadata.height);
	const results: GeneratedVariant[] = [];

	// Generate each variant
	for (const config of resolvedConfigs) {
		// Variant skipping — original is already smaller
		if (longEdge < config.max_dimension) {
			continue;
		}

		const fit: 'inside' | 'cover' = config.fit ?? (config.max_dimension > 1024 ? 'inside' : 'cover');
		const variant = await generateSingleVariant(input, config, fit, metadata.has_transparency);
		results.push(variant);
	}

	// Compressed original
	if (options.compress_original && options.keep_original) {
		const compressed = await generateCompressedOriginal(input, metadata.is_animated);
		results.push(compressed);
	}

	return results;
}

async function generateSingleVariant(
	input: Buffer,
	config: VariantConfig,
	fit: 'inside' | 'cover',
	has_transparency: boolean,
): Promise<GeneratedVariant> {
	const maxDim = config.max_dimension;

	// Sharp fit mode: 'inside' → 'inside', 'cover' → 'outside' (resize so short edge matches)
	const sharpFit = fit === 'inside' ? 'inside' : 'outside';

	let pipeline = sharp(input)
		.rotate() // auto-rotate from EXIF
		.resize(maxDim, maxDim, { fit: sharpFit as any, withoutEnlargement: true });

	// Handle JPEG + transparency: flatten with white background
	if (config.format === 'jpeg' && has_transparency) {
		pipeline = pipeline.flatten({ background: '#ffffff' });
	}

	// Apply format encoding
	const quality = config.quality ?? DEFAULT_QUALITY[config.format];
	switch (config.format) {
		case 'avif':
			pipeline = pipeline.avif({ quality, effort: config.effort ?? 4 });
			break;
		case 'webp':
			pipeline = pipeline.webp({ quality });
			break;
		case 'jpeg':
			pipeline = pipeline.jpeg({ quality, mozjpeg: true });
			break;
		case 'png':
			pipeline = pipeline.png({ compressionLevel: 9 });
			break;
	}

	const result = await pipeline.toBuffer({ resolveWithObject: true });

	return {
		name: config.name,
		data: result.data,
		width: result.info.width,
		height: result.info.height,
		mime_type: FORMAT_MIME[config.format],
		file_size: result.data.byteLength,
		is_animated: false,
		fit,
		watermarked: false,
	};
}

async function generateCompressedOriginal(
	input: Buffer,
	is_animated: boolean,
): Promise<GeneratedVariant> {
	// For animated inputs, use WebP; for static, use AVIF
	const format = is_animated ? 'webp' : 'avif';
	const sharpOpts = is_animated ? { animated: true } : {};

	let pipeline = sharp(input, sharpOpts).rotate();

	if (format === 'avif') {
		pipeline = pipeline.keepMetadata().avif({ quality: 50, effort: 4 });
	} else {
		pipeline = pipeline.keepMetadata().webp({ quality: 75 });
	}

	const result = await pipeline.toBuffer({ resolveWithObject: true });

	// For animated, correct the height to per-page height
	let height = result.info.height;
	if (is_animated) {
		const meta = await sharp(result.data).metadata();
		if (meta.pageHeight) height = meta.pageHeight;
	}

	return {
		name: 'original',
		data: result.data,
		width: result.info.width,
		height,
		mime_type: FORMAT_MIME[format],
		file_size: result.data.byteLength,
		is_animated,
		fit: 'inside',
		watermarked: false,
	};
}
