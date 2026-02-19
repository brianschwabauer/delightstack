import sharp from 'sharp';
import { detectMimeType } from './mime';
import { validateInput } from './validation';
import { extractMetadata, type MetadataResult } from './metadata';
import { extractColors, type ColorResult } from './colors';
import { generateVariants, type VariantConfig, type GeneratedVariant } from './variants';
import { generateThumbHash } from './thumbhash';

// Stubs for features implemented in later specs
async function faceCrop(input: Buffer, _metadata: MetadataResult): Promise<Buffer> {
	return input; // spec 12
}

async function applyWatermark(
	variant: GeneratedVariant,
	_watermarkImages?: Map<string, ArrayBuffer>,
): Promise<GeneratedVariant> {
	return variant; // spec 13
}

async function svgPipeline(_data: ArrayBuffer, _options: ProcessOptions): Promise<PipelineResult> {
	throw Object.assign(new Error('SVG processing not yet implemented'), {
		code: 'UNSUPPORTED_FORMAT',
		details: { mime_type: 'image/svg+xml', file_extension: 'svg' },
	});
}

async function pdfPipeline(_data: ArrayBuffer, _options: ProcessOptions): Promise<PipelineResult> {
	throw Object.assign(new Error('PDF processing not yet implemented'), {
		code: 'UNSUPPORTED_FORMAT',
		details: { mime_type: 'application/pdf', file_extension: 'pdf' },
	});
}

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

/** Resolve default fit per variant config if not explicitly set */
function resolveConfigs(configs: VariantConfig[] | undefined): VariantConfig[] {
	const resolved = configs?.length
		? configs.map((c) => ({ ...c }))
		: [
				{ name: 'default', max_dimension: 2048, format: 'avif' as const, quality: 50, effort: 4 },
				{ name: 'thumbnail', max_dimension: 640, format: 'avif' as const, quality: 50, effort: 4 },
			];

	for (const config of resolved) {
		if (!config.fit) {
			config.fit = config.max_dimension > 1024 ? 'inside' : 'cover';
		}
	}

	return resolved;
}

/**
 * Main processing pipeline entry point.
 * Called by the HTTP server with raw image bytes and options.
 */
export async function process(data: ArrayBuffer, options: ProcessOptions): Promise<PipelineResult> {
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

async function imagePipeline(
	data: ArrayBuffer,
	mimeResult: { mime_type: string; extension: string },
	options: ProcessOptions,
): Promise<PipelineResult> {
	const inputBuffer = Buffer.from(data);

	// Load with Sharp, auto-rotate from EXIF
	const instance = sharp(inputBuffer).rotate();

	// Check for animation
	const sharpMeta = await sharp(inputBuffer).metadata();
	const pages = sharpMeta.pages ?? 1;
	const is_animated = pages > 1;

	// For animated images, process first frame as static (full animated support in spec 08)
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

	// Resolve variant configs
	const resolvedConfigs = resolveConfigs(options.variants);
	const keep_original = options.keep_original ?? true;
	const compress_original = options.compress_original ?? true;

	// Generate variants and thumbhash in parallel
	const [variants, thumbhash] = await Promise.all([
		generateVariants(workingBuffer, coreMetadata, resolvedConfigs, {
			compress_original,
			keep_original,
		}),
		generateThumbHash(workingBuffer, is_animated),
	]);

	// Apply watermarks to variants that have watermark config
	const watermarkedVariants: GeneratedVariant[] = [];
	for (const variant of variants) {
		const config = resolvedConfigs.find((c) => c.name === variant.name);
		if (config?.watermark && variant.name !== 'original') {
			const watermarked = await applyWatermark(variant, options.watermark_images);
			watermarked.watermarked = true;
			watermarkedVariants.push(watermarked);
		} else {
			watermarkedVariants.push(variant);
		}
	}

	// Assemble result
	const metadata = {
		...coreMetadata,
		...colors,
	};

	return {
		metadata,
		thumbhash,
		variants: watermarkedVariants,
	};
}
