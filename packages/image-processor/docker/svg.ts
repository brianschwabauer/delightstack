import sharp from 'sharp';
import { generateThumbHash } from './thumbhash';
import type { ProcessOptions, PipelineResult } from './pipeline';

/** Dangerous SVG elements to remove */
const DANGEROUS_ELEMENTS = /(<script[\s>][\s\S]*?<\/script>|<foreignObject[\s>][\s\S]*?<\/foreignObject>|<iframe[\s>][\s\S]*?<\/iframe>|<embed[\s>][\s\S]*?<\/embed>|<object[\s>][\s\S]*?<\/object>)/gi;

/** Event handler attributes */
const EVENT_HANDLERS = /\s+on\w+\s*=\s*"[^"]*"/gi;

/** javascript: and data:text/html URLs */
const DANGEROUS_URLS = /(?:javascript|data\s*:\s*text\/html)\s*:/gi;

/** External href/xlink:href (keep internal #id references) */
const EXTERNAL_HREFS = /\s+((?:xlink:)?href)\s*=\s*"(https?:\/\/[^"]*)"/gi;

/**
 * Sanitize SVG content by removing dangerous elements and attributes.
 * Throws SVG_MALICIOUS if javascript: or data:text/html content is found.
 */
function sanitizeSvg(svgString: string): string {
	// Check for explicitly malicious content
	if (DANGEROUS_URLS.test(svgString)) {
		throw Object.assign(new Error('SVG contains dangerous JavaScript or data URLs'), {
			code: 'SVG_MALICIOUS',
			details: { reason: 'Contains javascript: or data:text/html URLs' },
		});
	}

	let sanitized = svgString;

	// Remove dangerous elements
	sanitized = sanitized.replace(DANGEROUS_ELEMENTS, '');

	// Remove event handler attributes
	sanitized = sanitized.replace(EVENT_HANDLERS, '');

	// Remove external hrefs (keep internal #id references)
	sanitized = sanitized.replace(EXTERNAL_HREFS, '');

	return sanitized;
}

/** Extract dimensions from SVG viewBox or width/height attributes */
function extractSvgDimensions(svgString: string): { width: number; height: number } {
	// Try viewBox first
	const viewBoxMatch = svgString.match(/viewBox\s*=\s*"([^"]+)"/);
	if (viewBoxMatch) {
		const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
		if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
			return { width: parts[2], height: parts[3] };
		}
	}

	// Fallback: width/height attributes
	const widthMatch = svgString.match(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)(?:px)?"/);
	const heightMatch = svgString.match(/\bheight\s*=\s*"(\d+(?:\.\d+)?)(?:px)?"/);
	if (widthMatch && heightMatch) {
		return { width: parseFloat(widthMatch[1]), height: parseFloat(heightMatch[1]) };
	}

	// Default fallback
	return { width: 300, height: 150 };
}

/**
 * SVG processing pipeline.
 * Sanitizes SVG, extracts metadata, generates ThumbHash.
 * Does NOT create resized variants (SVGs are resolution-independent).
 */
export async function svgPipeline(data: ArrayBuffer, options: ProcessOptions): Promise<PipelineResult> {
	const svgString = new TextDecoder().decode(data);
	const sanitized = sanitizeSvg(svgString);
	const dimensions = extractSvgDimensions(sanitized);
	const sanitizedBuffer = Buffer.from(sanitized);

	// Rasterize for ThumbHash
	const thumbhash = await generateThumbHash(sanitizedBuffer);

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
			aspect_ratio: dimensions.height > 0 ? Math.round((dimensions.width / dimensions.height) * 1000) / 1000 : 1,
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
			// Colors via rasterization
			background_color: { l: 0.95, c: 0, h: 0 },
			background_color_css: 'oklch(0.950 0.000 0.0)',
			accent_color: null,
			accent_color_css: null,
			luminance: 0.95,
		},
		thumbhash,
		variants: [svgVariant],
	};
}
