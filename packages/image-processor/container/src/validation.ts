import type { MimeResult } from './mime';
import { ALL_SUPPORTED_TYPES } from './mime';

interface ErrorLike {
	code: string;
	details: Record<string, unknown>;
}

function createValidationError(code: string, details: Record<string, unknown>): ErrorLike {
	const err: any = new Error(`${code}: ${JSON.stringify(details)}`);
	err.code = code;
	err.details = details;
	return err;
}

/** Maximum file sizes per format category (bytes) */
const SIZE_LIMITS: Record<string, number> = {
	'image/svg+xml': 5 * 1024 * 1024, // 5 MB
	'application/pdf': 50 * 1024 * 1024, // 50 MB
};

const RAW_PREFIXES = ['image/x-nikon', 'image/x-canon', 'image/x-sony', 'image/x-olympus', 'image/x-panasonic', 'image/x-fuji', 'image/x-pentax', 'image/x-samsung', 'image/x-adobe'];
const DEFAULT_SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB
const RAW_SIZE_LIMIT = 100 * 1024 * 1024; // 100 MB

/** Max pixel dimensions */
const MAX_MEGAPIXELS = 256;
const MAX_SINGLE_SIDE = 32_768;

function getSizeLimit(mime_type: string): number {
	if (SIZE_LIMITS[mime_type]) return SIZE_LIMITS[mime_type];
	if (RAW_PREFIXES.some((p) => mime_type.startsWith(p))) return RAW_SIZE_LIMIT;
	return DEFAULT_SIZE_LIMIT;
}

/** Read dimensions from JPEG header (SOF markers) */
function readJpegDimensions(data: ArrayBuffer): { width: number; height: number } | null {
	const view = new DataView(data);
	if (view.byteLength < 4) return null;
	if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return null;

	let offset = 2;
	while (offset < view.byteLength - 8) {
		if (view.getUint8(offset) !== 0xff) break;
		const marker = view.getUint8(offset + 1);

		// SOF markers (Start of Frame) — contain dimensions
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xcf)) {
			const height = view.getUint16(offset + 5);
			const width = view.getUint16(offset + 7);
			return { width, height };
		}

		// Skip to next marker
		const length = view.getUint16(offset + 2);
		offset += 2 + length;
	}
	return null;
}

/** Read dimensions from PNG header (IHDR chunk) */
function readPngDimensions(data: ArrayBuffer): { width: number; height: number } | null {
	const view = new DataView(data);
	if (view.byteLength < 24) return null;
	// PNG magic: 137 80 78 71 13 10 26 10
	if (view.getUint32(0) !== 0x89504e47) return null;

	// IHDR is always the first chunk, at offset 8
	// bytes 16-19: width, bytes 20-23: height
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	return { width, height };
}

/** Read dimensions from GIF header */
function readGifDimensions(data: ArrayBuffer): { width: number; height: number } | null {
	const view = new DataView(data);
	if (view.byteLength < 10) return null;
	// GIF87a or GIF89a
	const magic = new TextDecoder().decode(data.slice(0, 3));
	if (magic !== 'GIF') return null;

	// Width and height are little-endian uint16 at bytes 6-9
	const width = view.getUint16(6, true);
	const height = view.getUint16(8, true);
	return { width, height };
}

/** Try to read dimensions cheaply from file headers */
function quickDimensionCheck(data: ArrayBuffer, mime_type: string): { width: number; height: number } | null {
	switch (mime_type) {
		case 'image/jpeg':
			return readJpegDimensions(data);
		case 'image/png':
			return readPngDimensions(data);
		case 'image/gif':
			return readGifDimensions(data);
		default:
			return null;
	}
}

/** Validate input data. Throws on failure. */
export function validateInput(data: ArrayBuffer, mimeResult: MimeResult): void {
	// Step 1: Format check
	if (!ALL_SUPPORTED_TYPES.has(mimeResult.mime_type)) {
		throw createValidationError('UNSUPPORTED_FORMAT', {
			mime_type: mimeResult.mime_type,
			file_extension: mimeResult.extension,
		});
	}

	// Step 2: Size check
	const max_bytes = getSizeLimit(mimeResult.mime_type);
	if (data.byteLength > max_bytes) {
		throw createValidationError('FILE_TOO_LARGE', {
			max_bytes,
			actual_bytes: data.byteLength,
		});
	}

	// Step 3: Quick dimension check (header-based, no decode)
	const dims = quickDimensionCheck(data, mimeResult.mime_type);
	if (dims) {
		// Min dimension: must be at least 1x1
		if (dims.width < 1 || dims.height < 1) {
			throw createValidationError('DIMENSIONS_TOO_LARGE', {
				min_dimension: 1,
				width: dims.width,
				height: dims.height,
			});
		}

		const megapixels = (dims.width * dims.height) / 1_000_000;
		if (megapixels > MAX_MEGAPIXELS || dims.width > MAX_SINGLE_SIDE || dims.height > MAX_SINGLE_SIDE) {
			throw createValidationError('DIMENSIONS_TOO_LARGE', {
				max_megapixels: MAX_MEGAPIXELS,
				actual_megapixels: Math.round(megapixels * 100) / 100,
				width: dims.width,
				height: dims.height,
			});
		}
	}
}
