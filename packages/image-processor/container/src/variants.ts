import sharp from 'sharp';
import type { MetadataResult } from './metadata';

/** Watermark configuration for a variant */
export interface WatermarkConfig {
	text?: string;
	image?: string;
	layout?: 'repeat' | 'center' | 'corner';
	opacity?: number;
	rotation?: number;
	gap?: number;
	position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
	scale?: number;
}

export interface VariantConfig {
	name: string;
	max_dimension: number;
	format: 'avif' | 'webp' | 'jpeg' | 'png';
	quality?: number;
	effort?: number;
	fit?: 'inside' | 'cover';
	watermark?: WatermarkConfig;
}

export interface GeneratedVariant {
	name: string;
	data: Buffer;
	width: number;
	height: number;
	mime_type: string;
	file_size: number;
	is_animated: boolean;
	fit?: 'inside' | 'cover';
	watermarked: boolean;
}

/** Intermediate result after resize, before encoding. Used for watermark insertion. */
export interface ResizedVariant {
	name: string;
	raw_data: Buffer;
	width: number;
	height: number;
	format: 'avif' | 'webp' | 'jpeg' | 'png';
	quality?: number;
	effort?: number;
	fit: 'inside' | 'cover';
	has_transparency: boolean;
}

/** Default variants when none are specified */
export const DEFAULT_VARIANT_CONFIGS: VariantConfig[] = [
	{ name: 'default', max_dimension: 2048, format: 'avif', quality: 50, effort: 4, fit: 'inside' },
	{ name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4, fit: 'cover' },
];

/** Resolve default fit per variant config if not explicitly set */
export function resolveConfigs(configs: VariantConfig[] | undefined): VariantConfig[] {
	const resolved = configs?.length
		? configs.map((c) => ({ ...c }))
		: DEFAULT_VARIANT_CONFIGS.map((c) => ({ ...c }));

	for (const config of resolved) {
		if (!config.fit) {
			config.fit = config.max_dimension > 1024 ? 'inside' : 'cover';
		}
	}

	return resolved;
}

export const FORMAT_MIME: Record<string, string> = {
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
 * Resize variants without encoding. Returns raw PNG buffers suitable for
 * watermark compositing before final format encoding.
 */
export async function resizeVariants(
	input: Buffer,
	metadata: MetadataResult,
	configs: VariantConfig[],
): Promise<ResizedVariant[]> {
	const longEdge = Math.max(metadata.width, metadata.height);
	const results: ResizedVariant[] = [];

	for (const config of configs) {
		if (longEdge < config.max_dimension) continue;

		const fit: 'inside' | 'cover' = config.fit ?? (config.max_dimension > 1024 ? 'inside' : 'cover');
		const maxDim = config.max_dimension;
		const sharpFit: 'inside' | 'outside' = fit === 'inside' ? 'inside' : 'outside';

		const result = await sharp(input)
			.rotate()
			.resize(maxDim, maxDim, { fit: sharpFit, withoutEnlargement: true })
			.png() // lossless intermediate for watermarking
			.toBuffer({ resolveWithObject: true });

		results.push({
			name: config.name,
			raw_data: result.data,
			width: result.info.width,
			height: result.info.height,
			format: config.format,
			quality: config.quality,
			effort: config.effort,
			fit,
			has_transparency: metadata.has_transparency,
		});
	}

	return results;
}

/** Encode a raw PNG buffer into the target format */
export async function encodeVariant(
	resized: ResizedVariant,
	watermarked: boolean,
): Promise<GeneratedVariant> {
	let pipeline = sharp(resized.raw_data);

	if (resized.format === 'jpeg' && resized.has_transparency) {
		pipeline = pipeline.flatten({ background: '#ffffff' });
	}

	const quality = resized.quality ?? DEFAULT_QUALITY[resized.format];
	switch (resized.format) {
		case 'avif':
			pipeline = pipeline.avif({ quality, effort: resized.effort ?? 4 });
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
		name: resized.name,
		data: result.data,
		width: result.info.width,
		height: result.info.height,
		mime_type: FORMAT_MIME[resized.format],
		file_size: result.data.byteLength,
		is_animated: false,
		fit: resized.fit,
		watermarked,
	};
}

/**
 * Generate resized + encoded output variants from the source image.
 * Handles fit strategies, format encoding, quality, variant skipping, and compressed original.
 * NOTE: For watermark support, use resizeVariants() + encodeVariant() separately.
 */
export async function generateVariants(
	input: Buffer,
	metadata: MetadataResult,
	configs: VariantConfig[],
	options: { compress_original: boolean; keep_original: boolean },
): Promise<GeneratedVariant[]> {
	const resized = await resizeVariants(input, metadata, configs);
	const results: GeneratedVariant[] = [];

	for (const r of resized) {
		results.push(await encodeVariant(r, false));
	}

	// Compressed original
	if (options.compress_original && options.keep_original) {
		const compressed = await generateCompressedOriginal(input, metadata.is_animated);
		results.push(compressed);
	}

	return results;
}

export async function generateCompressedOriginal(
	input: Buffer,
	is_animated: boolean,
): Promise<GeneratedVariant> {
	const format = is_animated ? 'webp' : 'avif';
	const sharpOpts = is_animated ? { animated: true } : {};

	let pipeline = sharp(input, sharpOpts).rotate();

	if (format === 'avif') {
		pipeline = pipeline.keepMetadata().avif({ quality: 50, effort: 4 });
	} else {
		pipeline = pipeline.keepMetadata().webp({ quality: 75 });
	}

	const result = await pipeline.toBuffer({ resolveWithObject: true });

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
		watermarked: false,
	};
}
