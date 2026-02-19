import sharp from 'sharp';
import exifReader from 'exif-reader';
import type { MimeResult } from './mime';

/** EXIF orientation values that indicate width/height swap */
const ROTATED_ORIENTATIONS = new Set([5, 6, 7, 8]);

/** Convert GPS DMS (degrees, minutes, seconds) array + ref to decimal degrees */
function convertGps(
	dms: number[] | undefined,
	ref: string | undefined,
): number | null {
	if (!dms || dms.length < 3 || !ref) return null;
	const [degrees, minutes, seconds] = dms;
	let decimal = degrees + minutes / 60 + seconds / 3600;
	if (ref === 'S' || ref === 'W') decimal = -decimal;
	return Math.round(decimal * 1_000_000) / 1_000_000;
}

/** Derive file extension from filename */
function getFileExtension(file_name: string | null): string | null {
	if (!file_name) return null;
	const dot = file_name.lastIndexOf('.');
	if (dot === -1 || dot === file_name.length - 1) return null;
	return file_name.slice(dot + 1).toLowerCase();
}

export interface MetadataResult {
	file_name: string | null;
	file_extension: string | null;
	mime_type: string;
	file_size: number;
	width: number;
	height: number;
	aspect_ratio: number;
	has_transparency: boolean;
	is_animated: boolean;
	frame_count: number;
	color_space: string;
	bit_depth: number;
	channels: number;
	exif_orientation: number;
	has_icc_profile: boolean;
	density: number | undefined;
	date_taken: string | null;
	gps_latitude: number | null;
	gps_longitude: number | null;
	format_info: Record<string, unknown> | undefined;
}

/**
 * Extract all metadata from a Sharp instance.
 * Returns core metadata including dimensions, EXIF, GPS, animation info.
 */
export async function extractMetadata(
	input: Buffer,
	mimeResult: MimeResult,
	file_size: number,
	file_name: string | null = null,
): Promise<MetadataResult> {
	const instance = sharp(input);
	const meta = await instance.metadata();

	// Apply EXIF orientation correction to dimensions
	let width = meta.width ?? 0;
	let height = meta.height ?? 0;
	const orientation = meta.orientation ?? 1;

	if (ROTATED_ORIENTATIONS.has(orientation)) {
		[width, height] = [height, width];
	}

	// For animated images, height is the total height of all pages stacked
	const pages = meta.pages ?? 1;
	const is_animated = pages > 1;
	if (is_animated && meta.pageHeight) {
		height = meta.pageHeight;
	}

	// EXIF extraction
	let date_taken: string | null = null;
	let gps_latitude: number | null = null;
	let gps_longitude: number | null = null;

	if (meta.exif) {
		try {
			const parsed = exifReader(meta.exif);
			if (parsed?.exif?.DateTimeOriginal) {
				const d = parsed.exif.DateTimeOriginal;
				date_taken = d instanceof Date ? d.toISOString() : String(d);
			}
			if (parsed?.gps) {
				gps_latitude = convertGps(
					parsed.gps.GPSLatitude as number[] | undefined,
					parsed.gps.GPSLatitudeRef as string | undefined,
				);
				gps_longitude = convertGps(
					parsed.gps.GPSLongitude as number[] | undefined,
					parsed.gps.GPSLongitudeRef as string | undefined,
				);
			}
		} catch {
			// Malformed EXIF — skip
		}
	}

	const aspect_ratio = height > 0 ? Math.round((width / height) * 1000) / 1000 : 1;

	return {
		file_name,
		file_extension: getFileExtension(file_name),
		mime_type: mimeResult.mime_type,
		file_size,
		width,
		height,
		aspect_ratio,
		has_transparency: meta.hasAlpha ?? false,
		is_animated,
		frame_count: pages,
		color_space: meta.space ?? 'srgb',
		bit_depth: typeof meta.depth === 'string' ? parseInt(meta.depth) || 8 : (meta.depth as number) ?? 8,
		channels: meta.channels ?? 3,
		exif_orientation: orientation,
		has_icc_profile: meta.hasProfile ?? false,
		density: meta.density,
		date_taken,
		gps_latitude,
		gps_longitude,
		format_info: undefined,
	};
}
