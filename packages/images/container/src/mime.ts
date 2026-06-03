import { fileTypeFromBuffer } from 'file-type';

export interface MimeResult {
	mime_type: string;
	extension: string;
}

/** Supported MIME types for full image processing */
const SUPPORTED_IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/avif',
	'image/gif',
	'image/heic',
	'image/heif',
	'image/tiff',
	'image/bmp',
	'image/x-icon',
	'image/jp2',
	'image/jxl',
]);

/** Camera RAW MIME types */
const RAW_IMAGE_TYPES = new Set([
	'image/x-nikon-nef',
	'image/x-canon-cr2',
	'image/x-canon-cr3',
	'image/x-sony-arw',
	'image/x-olympus-orf',
	'image/x-panasonic-rw2',
	'image/x-fuji-raf',
	'image/x-pentax-pef',
	'image/x-samsung-srw',
	'image/x-adobe-dng',
]);

/** Special format types */
const SPECIAL_TYPES = new Set(['image/svg+xml', 'application/pdf']);

/** All supported types */
export const ALL_SUPPORTED_TYPES = new Set([
	...SUPPORTED_IMAGE_TYPES,
	...RAW_IMAGE_TYPES,
	...SPECIAL_TYPES,
]);

/** Check if data starts with SVG-like content */
function isSvg(data: ArrayBuffer): boolean {
	const text = new TextDecoder().decode(data.slice(0, 512));
	const trimmed = text.trimStart();
	return trimmed.startsWith('<?xml') || trimmed.startsWith('<svg');
}

/** Detect MIME type from magic bytes */
export async function detectMimeType(data: ArrayBuffer): Promise<MimeResult | null> {
	// Try magic byte detection first
	const result = await fileTypeFromBuffer(new Uint8Array(data));
	if (result) {
		return { mime_type: result.mime, extension: result.ext };
	}

	// SVGs are text-based — file-type won't detect them
	if (isSvg(data)) {
		return { mime_type: 'image/svg+xml', extension: 'svg' };
	}

	return null;
}
