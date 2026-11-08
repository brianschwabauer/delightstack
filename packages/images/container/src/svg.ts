import sharp from 'sharp';
import { generateThumbHash } from './thumbhash';
import { extractColors } from './colors';
import type { ProcessOptions, PipelineResult } from './pipeline';
import { sanitizeSvg } from './svg-sanitize';

/** Extract dimensions from SVG viewBox or width/height attributes */
function extractSvgDimensions(svgString: string): { width: number; height: number } {
	// Try viewBox first (supports both double and single quotes)
	const viewBoxMatch = svgString.match(/viewBox\s*=\s*(?:"([^"]+)"|'([^']+)')/);
	if (viewBoxMatch) {
		const value = viewBoxMatch[1] ?? viewBoxMatch[2];
		const parts = value
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
			return { width: parts[2], height: parts[3] };
		}
	}

	// Fallback: width/height attributes (supports both quote styles)
	const widthMatch = svgString.match(
		/\bwidth\s*=\s*(?:"(\d+(?:\.\d+)?)(?:px)?"|'(\d+(?:\.\d+)?)(?:px)?')/,
	);
	const heightMatch = svgString.match(
		/\bheight\s*=\s*(?:"(\d+(?:\.\d+)?)(?:px)?"|'(\d+(?:\.\d+)?)(?:px)?')/,
	);
	if (widthMatch && heightMatch) {
		const w = widthMatch[1] ?? widthMatch[2];
		const h = heightMatch[1] ?? heightMatch[2];
		return { width: parseFloat(w), height: parseFloat(h) };
	}

	// Default fallback
	return { width: 300, height: 150 };
}

/**
 * SVG processing pipeline.
 * Sanitizes SVG, extracts metadata, generates ThumbHash.
 * Does NOT create resized variants (SVGs are resolution-independent).
 */
export async function svgPipeline(
	data: ArrayBuffer,
	options: ProcessOptions,
): Promise<PipelineResult> {
	const svgString = new TextDecoder().decode(data);
	const sanitized = sanitizeSvg(svgString);
	const dimensions = extractSvgDimensions(sanitized);
	const sanitizedBuffer = Buffer.from(sanitized);

	// Rasterize for ThumbHash and color extraction
	const rasterized = await sharp(sanitizedBuffer).png().toBuffer();
	const [thumbhash, colors] = await Promise.all([
		generateThumbHash(rasterized),
		extractColors(rasterized),
	]);

	// The sanitized SVG is the only "variant"
	const svgVariant = {
		name: 'original',
		data: sanitizedBuffer,
		width: dimensions.width,
		height: dimensions.height,
		mime_type: 'image/svg+xml',
		file_size: sanitizedBuffer.byteLength,
		is_animated: false,
		fit: 'inside' as const,
		watermarked: false,
	};

	return {
		metadata: {
			file_name: options.file_name ?? null,
			file_extension: 'svg',
			mime_type: 'image/svg+xml',
			file_size: data.byteLength,
			width: dimensions.width,
			height: dimensions.height,
			aspect_ratio:
				dimensions.height > 0
					? Math.round((dimensions.width / dimensions.height) * 1000) / 1000
					: 1,
			has_transparency: true,
			is_animated: false,
			frame_count: 1,
			color_space: 'srgb',
			bit_depth: 8,
			channels: 4,
			exif_orientation: 1,
			has_icc_profile: false,
			density: undefined,
			date_taken: null,
			gps_latitude: null,
			gps_longitude: null,
			format_info: { type: 'svg' },
			...colors,
		},
		thumbhash,
		variants: [svgVariant],
	};
}
