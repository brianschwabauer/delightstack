import sharp from 'sharp';
import exifReader from 'exif-reader';
import type { MimeResult } from './mime';

/** EXIF orientation values that indicate width/height swap */
const ROTATED_ORIENTATIONS = new Set([5, 6, 7, 8]);

/** Map Sharp depth strings to actual bit depth values */
const DEPTH_MAP: Record<string, number> = {
	uchar: 8,
	char: 8,
	ushort: 16,
	short: 16,
	uint: 32,
	int: 32,
	float: 32,
	complex: 64,
	double: 64,
	dpcomplex: 128,
};

/** Convert GPS DMS (degrees, minutes, seconds) array + ref to decimal degrees */
function convertGps(dms: number[] | undefined, ref: string | undefined): number | null {
	if (!dms || dms.length < 3 || !ref) return null;
	const [degrees, minutes, seconds] = dms;
	let decimal = degrees + minutes / 60 + seconds / 3600;
	if (ref === 'S' || ref === 'W') decimal = -decimal;
	return Math.round(decimal * 1_000_000) / 1_000_000;
}

/**
 * EXIF `OffsetTime*` value ("+02:00", "-07:00", or "Z") to minutes east of
 * UTC, or null when unreadable. EXIF 2.31 §4.6.5 spells the format
 * `±HH:MM`; anything else is treated as absent rather than guessed at.
 */
function offsetMinutes(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed === 'Z') return 0;
	const match = trimmed.match(/^([+-])(\d{2}):(\d{2})$/);
	if (!match) return null;
	const minutes_part = Number(match[3]);
	if (minutes_part > 59) return null; // "+02:99" is not a time
	const minutes = Number(match[2]) * 60 + minutes_part;
	if (minutes > 14 * 60) return null; // beyond any real UTC offset
	return match[1] === '-' ? -minutes : minutes;
}

/**
 * Normalize an EXIF capture time to canonical UTC ISO 8601, or null.
 *
 * exif-reader parses `DateTimeOriginal` ("2019:06:12 14:03:00" — a zoneless
 * wall clock) into a Date *stamped as UTC*. When `OffsetTimeOriginal` names
 * the wall clock's real zone, the true UTC instant is that stamp minus the
 * offset; without one, the wall clock stamped as UTC is the best available
 * reading. Never a passthrough of the EXIF spelling: consumers compare this
 * string lexicographically against UTC ISO boundaries, so an unnormalized
 * value silently misorders and misfilters.
 */
function normalizeDateTaken(date: unknown, offset_time: unknown): string | null {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
	const offset = offsetMinutes(offset_time);
	const utc = offset === null ? date : new Date(date.getTime() - offset * 60_000);
	return utc.toISOString();
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
			date_taken = normalizeDateTaken(
				parsed.Photo?.DateTimeOriginal,
				parsed.Photo?.OffsetTimeOriginal,
			);
			if (parsed.GPSInfo) {
				gps_latitude = convertGps(
					parsed.GPSInfo.GPSLatitude as number[] | undefined,
					parsed.GPSInfo.GPSLatitudeRef as string | undefined,
				);
				gps_longitude = convertGps(
					parsed.GPSInfo.GPSLongitude as number[] | undefined,
					parsed.GPSInfo.GPSLongitudeRef as string | undefined,
				);
			}
		} catch {
			// Malformed EXIF — skip
		}
	}

	const aspect_ratio = height > 0 ? Math.round((width / height) * 1000) / 1000 : 1;

	// Build format-specific info
	const format_info: Record<string, unknown> = {};
	if (meta.format) format_info.type = meta.format;
	if (meta.isProgressive !== undefined) format_info.progressive = meta.isProgressive;
	if (meta.loop !== undefined) format_info.loop_count = meta.loop;
	if (meta.delay?.length) format_info.frame_delays = meta.delay;
	if (meta.chromaSubsampling) format_info.chroma_subsampling = meta.chromaSubsampling;
	if (meta.compression) format_info.compression = meta.compression;

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
		bit_depth:
			typeof meta.depth === 'string'
				? (DEPTH_MAP[meta.depth] ?? 8)
				: ((meta.depth ?? 8) as number),
		channels: meta.channels ?? 3,
		exif_orientation: orientation,
		has_icc_profile: meta.hasProfile ?? false,
		density: meta.density,
		date_taken,
		gps_latitude,
		gps_longitude,
		format_info: Object.keys(format_info).length > 0 ? format_info : undefined,
	};
}
