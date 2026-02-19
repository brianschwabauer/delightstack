// ── Error codes ──────────────────────────────────────────────────────────────

/** All error codes that can be returned by the image processor */
export type ErrorCode =
	| 'FILE_NOT_FOUND'
	| 'FILE_TOO_LARGE'
	| 'DIMENSIONS_TOO_LARGE'
	| 'UNSUPPORTED_FORMAT'
	| 'TOO_MANY_FRAMES'
	| 'CORRUPTED_FILE'
	| 'SVG_MALICIOUS'
	| 'PROCESSING_TIMEOUT'
	| 'CONTAINER_UNAVAILABLE'
	| 'INTERNAL_ERROR';

// ── Watermark ────────────────────────────────────────────────────────────────

/** Watermark configuration for a variant */
export interface WatermarkConfig {
	/** Repeating text watermark (e.g. '© Acme Photos'). Mutually exclusive with `image`. */
	text?: string;

	/**
	 * R2 key or URL of a watermark image (e.g. a transparent PNG logo).
	 * Mutually exclusive with `text`. The caller fetches this before sending
	 * to the container (which has no internet access).
	 */
	image?: string;

	/**
	 * How the watermark is positioned.
	 * - 'repeat': Tiled diagonally across the entire image (default)
	 * - 'center': Single instance centered on the image
	 * - 'corner': Single instance in one corner
	 */
	layout?: 'repeat' | 'center' | 'corner';

	/** Opacity (0-1). Default: 0.3 */
	opacity?: number;

	/**
	 * Rotation in degrees. Applied to each tile for 'repeat', to the watermark for 'center'/'corner'.
	 * Default: -30 for 'repeat', 0 otherwise.
	 */
	rotation?: number;

	/** Gap between repeated tiles in pixels. Only applies to layout: 'repeat'. Default: 64 */
	gap?: number;

	/** Corner position. Only applies to layout: 'corner'. Default: 'bottom-right' */
	position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

	/**
	 * Scale factor for the watermark image relative to the variant's short edge (0-1).
	 * Only applies to `image` watermarks. Default: 0.25
	 */
	scale?: number;
}

// ── Variant config ───────────────────────────────────────────────────────────

export interface VariantConfig {
	/** Unique name for this variant (used in output key and result lookup) */
	name: string;

	/** Maximum dimension in pixels. Behavior depends on `fit`. */
	max_dimension: number;

	/** Output format. For animated inputs, 'avif' automatically falls back to 'webp'. */
	format: 'avif' | 'webp' | 'jpeg' | 'png';

	/** Quality (1-100). Default: 50 for AVIF, 75 for WebP, 80 for JPEG, lossless for PNG */
	quality?: number;

	/** Encoding effort (0-9, higher = slower + better compression). Only applies to AVIF. Default: 4 */
	effort?: number;

	/**
	 * Resize strategy.
	 * - 'inside': The long edge fits within max_dimension. Default for max_dimension > 1024.
	 * - 'cover': The short edge fits within max_dimension (no crop). Default for max_dimension <= 1024.
	 */
	fit?: 'inside' | 'cover';

	/**
	 * Watermark to composite on top of this variant.
	 * Specify either `text` or `image`, not both. Default: no watermark.
	 */
	watermark?: WatermarkConfig;
}

/** Default variants when none are specified */
export const DEFAULT_VARIANTS: VariantConfig[] = [
	{ name: 'default', max_dimension: 2048, format: 'avif', quality: 50, effort: 4, fit: 'inside' },
	{ name: 'thumbnail', max_dimension: 640, format: 'avif', quality: 50, effort: 4, fit: 'cover' },
];

// ── Processing options (Mode 2: standalone) ──────────────────────────────────

export interface ProcessImageOptions {
	/** The R2 bucket binding to use for input/output */
	bucket: R2Bucket;

	/** The key/path of the input file in the bucket */
	key: string;

	/** Whether to keep the original file after processing. Default: true */
	keep_original?: boolean;

	/**
	 * Whether to re-encode the original at full resolution as AVIF.
	 * Default: true. Only applies when keep_original is true.
	 */
	compress_original?: boolean;

	/** Custom variant configuration. If omitted, uses the default variants. */
	variants?: VariantConfig[];

	/**
	 * Enable avatar mode: face-aware square crop, keep_original defaults to false,
	 * single thumbnail variant (640px).
	 */
	avatar?: boolean;
}

// ── Upload options (Mode 1: database integration) ────────────────────────────

export interface UploadOptions {
	/**
	 * R2 path prefix for all files related to this image.
	 * Default: 'images'. Files are stored at {prefix}/{id}/{variant_name}.
	 */
	prefix?: string;

	/**
	 * Original filename (e.g. "vacation-photo.jpg").
	 * If data is a File, this is extracted automatically from file.name.
	 * Provide explicitly to override.
	 */
	file_name?: string;

	/**
	 * Alt text for the image. Stored in the database record.
	 * Default: null.
	 */
	alt_text?: string;

	/** Whether to keep the original file after processing. Default: true */
	keep_original?: boolean;

	/**
	 * Whether to re-encode the original at full resolution as AVIF.
	 * Default: true. Only applies when keep_original is true.
	 */
	compress_original?: boolean;

	/** Custom variant configuration. If omitted, uses the default variants. */
	variants?: VariantConfig[];

	/**
	 * Enable avatar mode: face-aware square crop, keep_original defaults to false,
	 * single thumbnail variant (640px).
	 */
	avatar?: boolean;

	/**
	 * Custom field values to store in the image record.
	 * These correspond to the fields defined in the defineImageTable() callback.
	 */
	data?: Record<string, unknown>;
}

// ── Image metadata ───────────────────────────────────────────────────────────

/** OKLCH color value */
export interface OklchColor {
	/** Lightness (0-1) */
	l: number;
	/** Chroma (0-0.4) */
	c: number;
	/** Hue (0-360) */
	h: number;
}

/** Metadata extracted from the original image */
export interface ImageMetadata {
	/** Original filename if provided at upload, or null */
	file_name: string | null;

	/** File extension from file_name (lowercase, without dot), or null */
	file_extension: string | null;

	/** Detected MIME type from file magic bytes (not from extension) */
	mime_type: string;

	/** File size in bytes */
	file_size: number;

	/** Original width in pixels (after orientation correction) */
	width: number;

	/** Original height in pixels (after orientation correction) */
	height: number;

	/** Aspect ratio as width/height (e.g. 1.778 for 16:9) */
	aspect_ratio: number;

	/** Whether the image has an alpha channel with non-opaque data */
	has_transparency: boolean;

	/** Whether the image is animated (GIF, APNG, animated WebP) */
	is_animated: boolean;

	/** Number of animation frames (1 for static images) */
	frame_count: number;

	/** Color space (srgb, display-p3, adobe-rgb, cmyk, etc.) */
	color_space: string;

	/** Bits per channel */
	bit_depth: number;

	/** Number of channels (3 for RGB, 4 for RGBA, etc.) */
	channels: number;

	/**
	 * Background color in OKLCH format.
	 * The average color of the image, computed by resizing to 1x1 pixel.
	 */
	background_color: OklchColor;

	/** Background color as a CSS oklch() string (e.g. "oklch(0.65 0.04 210)") */
	background_color_css: string;

	/**
	 * Accent color in OKLCH format.
	 * The most visually prominent/saturated color in the image.
	 * Null for achromatic images.
	 */
	accent_color: OklchColor | null;

	/** Accent color as a CSS oklch() string, or null for achromatic images */
	accent_color_css: string | null;

	/**
	 * Average perceived brightness (0-1).
	 * The lightness component of the background_color OKLCH value.
	 */
	luminance: number;

	/**
	 * Date/time the photo was taken, from EXIF DateTimeOriginal.
	 * ISO 8601 string. Null if no EXIF date is present.
	 */
	date_taken: string | null;

	/** GPS latitude from EXIF, in decimal degrees. Null if no GPS data. */
	gps_latitude: number | null;

	/** GPS longitude from EXIF, in decimal degrees. Null if no GPS data. */
	gps_longitude: number | null;

	/** EXIF orientation value (1-8) before correction. 1 = no rotation needed */
	exif_orientation: number;

	/** Whether the image has an embedded ICC profile */
	has_icc_profile: boolean;

	/** DPI/PPI if available */
	density?: number;

	/** Format-specific info (e.g. GIF loop count, PNG interlace, JPEG progressive) */
	format_info?: Record<string, unknown>;
}

// ── Output variants ──────────────────────────────────────────────────────────

/** Info about a generated output variant (after R2 upload) */
export interface OutputVariant {
	/** Variant name (e.g. 'default', 'thumbnail', 'original') */
	name: string;

	/** R2 key where the variant was saved (extensionless, e.g. 'images/{id}/default') */
	key: string;

	/** MIME type of the variant (e.g. 'image/avif', 'image/jpeg') */
	mime_type: string;

	/** Width in pixels */
	width: number;

	/** Height in pixels */
	height: number;

	/** File size in bytes */
	file_size: number;

	/** Whether this variant is animated */
	is_animated: boolean;

	/** Fit strategy used: 'inside' or 'cover'. Absent for 'original'. */
	fit?: 'inside' | 'cover';

	/** Whether this variant has a watermark applied */
	watermarked?: boolean;
}

/** Variant data returned by the container (includes binary, no R2 key yet) */
export interface ContainerOutputVariant {
	/** Variant name */
	name: string;

	/** MIME type of the encoded variant */
	mime_type: string;

	/** Width in pixels */
	width: number;

	/** Height in pixels */
	height: number;

	/** File size in bytes */
	file_size: number;

	/** Whether this variant is animated */
	is_animated: boolean;

	/** Fit strategy used */
	fit?: 'inside' | 'cover';

	/** Whether this variant has a watermark applied */
	watermarked?: boolean;

	/** The encoded image bytes */
	data: ArrayBuffer;
}

// ── Processing results ───────────────────────────────────────────────────────

/** Result returned by processImage() (Mode 2) and by processAlarm() internally */
export interface ProcessImageResult {
	/** Whether processing succeeded */
	ok: true;

	/** Unique processing job ID */
	job_id: string;

	/** Metadata extracted from the original image */
	metadata: ImageMetadata;

	/** ThumbHash as a base64 string (~33 chars) */
	thumbhash: string;

	/** The generated output variants */
	variants: OutputVariant[];
}

/** Result returned by the container's process endpoint */
export interface ContainerProcessResult {
	/** Metadata extracted from the original image */
	metadata: ImageMetadata;

	/** ThumbHash as a base64 string */
	thumbhash: string;

	/** Generated variants with binary data */
	variants: ContainerOutputVariant[];
}

// ── Database record ──────────────────────────────────────────────────────────

/** Processing status of an image */
export type ProcessingStatus = 'pending' | 'processing' | 'processed' | 'failed';

/** Shape of a database image record (flat columns, matches SQL schema) */
export interface ImageRecord {
	id: string;
	base_path: string;
	file_name: string | null;
	alt_text: string | null;
	processing_status: ProcessingStatus;
	error_code: string | null;
	mime_type: string | null;
	file_size: number | null;
	width: number | null;
	height: number | null;
	aspect_ratio: number | null;
	has_transparency: boolean | null;
	is_animated: boolean | null;
	frame_count: number | null;
	background_color_l: number | null;
	background_color_c: number | null;
	background_color_h: number | null;
	accent_color_l: number | null;
	accent_color_c: number | null;
	accent_color_h: number | null;
	luminance: number | null;
	date_taken: string | null;
	gps_latitude: number | null;
	gps_longitude: number | null;
	thumbhash: string | null;
	/** JSON string of variant info */
	variants: string | null;
	created_at: string;
	updated_at: string;
}

// ── Minimal types for external dependencies ──────────────────────────────────

/** Minimal SvelteKit-compatible request event (avoids hard dependency on @sveltejs/kit) */
export interface RequestEventLike {
	url: URL;
	request: Request;
	platform?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Minimal database interface compatible with @delightstack/database's DatabaseServer.
 * Avoids tight coupling — the consumer must have @delightstack/database installed.
 */
export interface DatabaseLike {
	create(table: string, data: Record<string, unknown>): Promise<unknown>;
	query<T = Record<string, unknown>>(table: string, sql: string): Promise<T[] | null>;
	update(table: string, id: string, data: Record<string, unknown>): Promise<unknown>;
	delete(table: string, id: string): Promise<unknown>;
	get<T = Record<string, unknown>>(table: string, id: string): Promise<T | null>;
	ctx: { storage: DurableObjectStorage };
}

// ── Schema builder types ─────────────────────────────────────────────────────

/** A single field in the schema builder */
export interface SchemaField {
	primaryKey(): SchemaField;
	optional(): SchemaField;
}

/** The schema builder passed to table definition callbacks */
export interface SchemaBuilder {
	string(): SchemaField;
	number(): SchemaField;
	boolean(): SchemaField;
}

/** Function that defines a table (from @delightstack/database) */
export type TableDefiner = (
	name: string,
	callback: (schema: SchemaBuilder) => Record<string, SchemaField>,
) => unknown;

// ── CDN hook options ─────────────────────────────────────────────────────────

/** Options for createImageHandle() */
export interface CreateImageHandleOptions {
	/** Function to get the R2 bucket binding from the request event */
	bucket: (event: RequestEventLike) => R2Bucket;

	/** R2 key prefix. Default: 'images' */
	prefix?: string;

	/** URL path prefix for image routes. Default: '/cdn/image' */
	cdn_prefix?: string;

	/** Variant to serve when none is specified in the URL. Default: 'default' */
	default_variant?: string;

	/** SVG string to serve as a 404 placeholder. Default: built-in "Image not found" SVG */
	placeholder?: string;
}

// ── Database integration options ─────────────────────────────────────────────

/** Options for the imageProcessing() factory */
export interface ImageProcessingOptions {
	/** Function to get the Container DO namespace binding */
	container: () => DurableObjectNamespace;

	/** Function to get the R2 bucket binding */
	bucket: () => R2Bucket;

	/** Whether to keep the original file after processing. Default: true */
	keep_original?: boolean;

	/** Whether to re-encode the original at full resolution as AVIF. Default: true */
	compress_original?: boolean;

	/** Default variant configuration. If omitted, uses the default variants. */
	variants?: VariantConfig[];

	/** R2 key prefix. Default: 'images' */
	prefix?: string;
}
