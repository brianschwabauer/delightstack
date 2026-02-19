import sharp from 'sharp';
import { extractMetadata } from './metadata';
import { extractColors } from './colors';
import { generateVariants } from './variants';
import { generateThumbHash } from './thumbhash';
import type { ProcessOptions, PipelineResult } from './pipeline';

/**
 * PDF processing pipeline.
 * Renders first page to raster via Sharp's poppler support,
 * then processes through the standard static image pipeline.
 */
export async function pdfPipeline(data: ArrayBuffer, options: ProcessOptions): Promise<PipelineResult> {
	const inputBuffer = Buffer.from(data);

	// Render first page to raster (density = DPI for rasterization)
	const rendered = sharp(inputBuffer, {
		density: 150,
		page: 0,
	});

	const rasterBuffer = await rendered.png().toBuffer();

	// Extract metadata from the rendered raster
	const mimeResult = { mime_type: 'application/pdf', extension: 'pdf' };
	const coreMetadata = await extractMetadata(
		rasterBuffer,
		mimeResult,
		data.byteLength,
		options.file_name ?? null,
	);

	// Override with PDF-specific info
	coreMetadata.mime_type = 'application/pdf';
	coreMetadata.file_extension = 'pdf';

	// Try to get page count from Sharp metadata
	try {
		const pdfMeta = await sharp(inputBuffer).metadata();
		if (pdfMeta.pages) {
			coreMetadata.format_info = { page_count: pdfMeta.pages };
		}
	} catch {
		// Page count extraction failed — not critical
	}

	// Extract colors from rasterized page
	const colors = await extractColors(rasterBuffer);

	// Resolve variant configs
	const configs = options.variants?.length
		? options.variants.map((c) => ({
				...c,
				fit: c.fit ?? (c.max_dimension > 1024 ? 'inside' : 'cover'),
			}))
		: [
				{ name: 'default', max_dimension: 2048, format: 'avif' as const, quality: 50, effort: 4, fit: 'inside' as const },
				{ name: 'thumbnail', max_dimension: 640, format: 'avif' as const, quality: 50, effort: 4, fit: 'cover' as const },
			];

	const keep_original = options.keep_original ?? true;
	const compress_original = options.compress_original ?? true;

	// Generate variants and thumbhash from rasterized page
	const [variants, thumbhash] = await Promise.all([
		generateVariants(rasterBuffer, coreMetadata, configs, {
			compress_original,
			keep_original,
		}),
		generateThumbHash(rasterBuffer),
	]);

	return {
		metadata: {
			...coreMetadata,
			...colors,
		},
		thumbhash,
		variants,
	};
}
