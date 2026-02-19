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
