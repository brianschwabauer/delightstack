import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

/**
 * Generate a ThumbHash from a Sharp instance.
 * Returns a base64-encoded string (~33 chars).
 */
export async function generateThumbHash(input: Buffer | ArrayBuffer, is_animated = false): Promise<string> {
	// For animated images, use first frame only
	const sharpOptions = is_animated ? { page: 0 } : {};

	const preview = await sharp(Buffer.from(input), sharpOptions)
		.resize(100, 100, { fit: 'inside' })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const hash = rgbaToThumbHash(preview.info.width, preview.info.height, preview.data);

	return Buffer.from(hash).toString('base64');
}
