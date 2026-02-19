import sharp from 'sharp';
import { generateThumbHash } from './thumbhash';
import { extractColors } from './colors';
import type { ProcessOptions, PipelineResult } from './pipeline';

/** Dangerous SVG elements to remove (includes animation elements that can trigger JS) */
const DANGEROUS_ELEMENTS = /(<script[\s>][\s\S]*?<\/script>|<foreignObject[\s>][\s\S]*?<\/foreignObject>|<iframe[\s>][\s\S]*?<\/iframe>|<embed[\s>][\s\S]*?<\/embed>|<object[\s>][\s\S]*?<\/object>|<set[\s>][\s\S]*?(?:<\/set>|\/>)|<animate[\s>][\s\S]*?(?:<\/animate>|\/>)|<animateTransform[\s>][\s\S]*?(?:<\/animateTransform>|\/>))/gi;

/** Event handler attributes (supports double-quoted, single-quoted, and unquoted values) */
const EVENT_HANDLERS = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi;

/** javascript: and data:text/html URLs — no `g` flag to avoid .test() statefulness */
const DANGEROUS_URLS = /(?:javascript|data\s*:\s*text\/html)\s*:/i;

/** External href/xlink:href (both quote styles; keep internal #id references) */
const EXTERNAL_HREFS = /\s+((?:xlink:)?href)\s*=\s*(?:"(https?:\/\/[^"]*)"|'(https?:\/\/[^']*)')/gi;

/** <use> elements with external href (can reference malicious SVGs) */
const EXTERNAL_USE = /<use[\s][^>]*(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*')[^>]*\/?>/gi;

/**
 * Sanitize SVG content by removing dangerous elements and attributes.
 * Throws SVG_MALICIOUS if javascript: or data:text/html content is found.
 */
function sanitizeSvg(svgString: string): string {
	// Check for explicitly malicious content (no `g` flag — safe to call repeatedly)
	if (DANGEROUS_URLS.test(svgString)) {
		throw Object.assign(new Error('SVG contains dangerous JavaScript or data URLs'), {
			code: 'SVG_MALICIOUS',
			details: 'Contains javascript: or data:text/html URLs',
		});
	}

	let sanitized = svgString;

	// Remove dangerous elements (script, foreignObject, iframe, embed, object, animation)
	sanitized = sanitized.replace(DANGEROUS_ELEMENTS, '');

	// Remove <use> elements with external references
	sanitized = sanitized.replace(EXTERNAL_USE, '');

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
			...colors,
		},
		thumbhash,
		variants: [svgVariant],
	};
}
