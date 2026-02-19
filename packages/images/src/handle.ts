import type { CreateImageHandleOptions, RequestEventLike } from './types';
import { encodeContentDisposition } from '@delightstack/utilities';

const DEFAULT_PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#f0f0f0"/>
  <text x="200" y="158" text-anchor="middle" fill="#999"
    font-family="system-ui,sans-serif" font-size="16">Image not found</text>
</svg>`;

/**
 * Create a SvelteKit Handle function for serving images from R2.
 *
 * Intercepts requests to the CDN prefix path, reads R2 objects,
 * and returns them with correct headers. Supports ETag/304 conditional
 * requests and serves a customizable SVG placeholder for missing images.
 *
 * Usage:
 *   import { sequence } from '@sveltejs/kit/hooks';
 *   const imageHandle = createImageHandle({
 *     bucket: (event) => event.platform!.env.MEDIA_BUCKET,
 *   });
 *   export const handle = sequence(imageHandle, ...otherHandles);
 */
export function createImageHandle(options: CreateImageHandleOptions) {
	const prefix = (options.prefix ?? 'images').replace(/\/$/, '');
	const cdnPrefix = (options.cdn_prefix ?? '/cdn/image').replace(/\/$/, '') + '/';
	const defaultVariant = options.default_variant ?? 'default';
	const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;

	return async function handle({ event, resolve }: { event: RequestEventLike; resolve: (event: RequestEventLike) => Promise<Response> }): Promise<Response> {
		// Only intercept requests under the CDN prefix
		if (!event.url.pathname.startsWith(cdnPrefix)) {
			return resolve(event);
		}

		const path = event.url.pathname.slice(cdnPrefix.length);
		const segments = path.split('/').filter(Boolean);
		const id = segments[0];
		const variant = segments[1] || defaultVariant;

		// Validate id and variant — reject empty, slashes, or path traversal
		if (!id || id.includes('..') || variant.includes('..') || variant.includes('/')) {
			return new Response(placeholder, {
				status: 404,
				headers: {
					'Content-Type': 'image/svg+xml',
					'Cache-Control': 'no-cache',
					'X-Content-Type-Options': 'nosniff',
				},
			});
		}

		const key = `${prefix}/${id}/${variant}`;
		const bucket = options.bucket(event);

		// Handle conditional requests (If-None-Match → 304)
		const ifNoneMatch = event.request.headers.get('If-None-Match');
		if (ifNoneMatch) {
			const head = await bucket.head(key);
			if (head && ifNoneMatch === head.httpEtag) {
				return new Response(null, { status: 304 });
			}
		}

		// Read the R2 object
		const object = await bucket.get(key);

		if (!object) {
			return new Response(placeholder, {
				status: 404,
				headers: {
					'Content-Type': 'image/svg+xml',
					'Cache-Control': 'no-cache',
					'X-Content-Type-Options': 'nosniff',
				},
			});
		}

		// Build response headers
		const headers = new Headers();
		headers.set(
			'Content-Type',
			object.httpMetadata?.contentType ?? 'application/octet-stream',
		);
		headers.set(
			'Cache-Control',
			object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
		);
		headers.set('ETag', object.httpEtag);
		headers.set('X-Content-Type-Options', 'nosniff');
		if (object.size !== undefined) {
			headers.set('Content-Length', String(object.size));
		}

		// Expose image dimensions
		if (object.customMetadata?.width) {
			headers.set('X-Image-Width', object.customMetadata.width);
		}
		if (object.customMetadata?.height) {
			headers.set('X-Image-Height', object.customMetadata.height);
		}

		// Content-Disposition for original variant (download with original filename)
		if (variant === 'original' && object.customMetadata?.['original-filename']) {
			const encoded = encodeContentDisposition(object.customMetadata['original-filename']);
			headers.set('Content-Disposition', `inline; filename="${encoded}"`);
		}

		return new Response(object.body, {
			status: 200,
			headers,
		});
	};
}
