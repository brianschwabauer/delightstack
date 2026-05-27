import { thumbHashToDataURL } from 'thumbhash';

/** Decode a base64 thumbhash to a data:image/png URL. Works server-side (pure JS, no canvas). */
export function decodeThumbHash(base64: string): string {
	const binary = atob(base64);
	const hash = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		hash[i] = binary.charCodeAt(i);
	}
	return thumbHashToDataURL(hash);
}

/** Build a CDN URL for an image variant. */
export function imageURL(
	image_id: string,
	variant = 'default',
	cdn_prefix = '/cdn/image',
): string {
	return `${cdn_prefix}/${image_id}/${variant}`;
}

/** A single variant produced by the image processing pipeline. */
export interface ImageVariant {
	name: string;
	width: number;
	height: number;
	watermarked?: boolean;
}

/**
 * The shape of a row from a table defined with `defineImageTable`. Permissive
 * about nullability so `toImageProps` works on raw db rows without coercion.
 */
export interface ImageRecord {
	id: string;
	processing_status?: string;
	file_name?: string | null;
	alt_text?: string | null;
	width?: number | null;
	height?: number | null;
	aspect_ratio?: number | null;
	thumbhash?: string | null;
	background_color_l?: number | null;
	background_color_c?: number | null;
	background_color_h?: number | null;
	variants?: ImageVariant[] | string | null;
}

/** The props produced by {@link toImageProps}, matching `@delightstack/components` `<Image>`. */
export interface ImageProps {
	src: string;
	srcset?: string;
	width?: number;
	height?: number;
	aspect_ratio?: string;
	alt: string;
	thumbhash?: string;
	bg_color?: string;
}

/**
 * Convert an image record into props for `<Image>` from `@delightstack/components`.
 *
 * @example
 * ```svelte
 * <script>
 *   import { Image } from '@delightstack/components';
 *   import { toImageProps } from '@delightstack/images';
 * </script>
 * <Image {...toImageProps(image)} />
 * ```
 *
 * Pass `cdn_prefix` to override the URL base (defaults to `/cdn/image`).
 * If your variants are stored elsewhere or use a different URL scheme,
 * skip this helper and build the `src`/`srcset` strings yourself.
 */
export function toImageProps(
	image: ImageRecord,
	options?: { cdn_prefix?: string },
): ImageProps {
	const cdn_prefix = options?.cdn_prefix ?? '/cdn/image';

	const variants: ImageVariant[] = (() => {
		if (!image.variants) return [];
		if (typeof image.variants !== 'string') return image.variants;
		try {
			return JSON.parse(image.variants) as ImageVariant[];
		} catch {
			return [];
		}
	})();

	const usable = variants
		.filter((v) => v.name !== 'original' && !v.watermarked)
		.sort((a, b) => a.width - b.width);

	const srcset = usable
		.map((v) => `${cdn_prefix}/${image.id}/${v.name} ${v.width}w`)
		.join(', ');

	const largest = usable.length > 0 ? usable[usable.length - 1] : undefined;
	const src = `${cdn_prefix}/${image.id}/${largest?.name ?? 'default'}`;

	const alt = image.alt_text ?? image.file_name?.replace(/\.[^.]+$/, '') ?? '';

	const bg_color =
		image.background_color_l != null
			? `oklch(${image.background_color_l} ${image.background_color_c ?? 0} ${image.background_color_h ?? 0})`
			: undefined;

	return {
		src,
		srcset: srcset || undefined,
		width: image.width ?? undefined,
		height: image.height ?? undefined,
		aspect_ratio: image.aspect_ratio != null ? String(image.aspect_ratio) : undefined,
		alt,
		thumbhash: image.thumbhash ?? undefined,
		bg_color,
	};
}
