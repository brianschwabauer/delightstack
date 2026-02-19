import { Container } from '@cloudflare/containers';
import type { VariantConfig, ContainerProcessResult, ContainerOutputVariant } from './types';
import { createError } from './errors';

const BOUNDARY = '----imgproc';

interface ContainerProcessOptions {
	variants?: VariantConfig[];
	compress_original?: boolean;
	avatar?: boolean;
	bucket?: R2Bucket;
}

/** Parse a multipart/mixed response from the container into structured data */
async function parseMultipartResponse(response: Response): Promise<ContainerProcessResult> {
	const contentType = response.headers.get('Content-Type') ?? '';
	const boundaryMatch = contentType.match(/boundary=(.+)/);
	const boundary = boundaryMatch?.[1] ?? BOUNDARY;

	const arrayBuffer = await response.arrayBuffer();
	const bytes = new Uint8Array(arrayBuffer);
	const decoder = new TextDecoder();

	// Find boundary positions
	const boundaryBytes = new TextEncoder().encode(`--${boundary}`);
	const positions: number[] = [];

	for (let i = 0; i < bytes.length - boundaryBytes.length; i++) {
		let match = true;
		for (let j = 0; j < boundaryBytes.length; j++) {
			if (bytes[i + j] !== boundaryBytes[j]) {
				match = false;
				break;
			}
		}
		if (match) positions.push(i);
	}

	if (positions.length < 2) {
		throw createError('INTERNAL_ERROR', { details: 'Invalid multipart response from container' });
	}

	let jsonData: any = null;
	const binaryParts: Map<string, ArrayBuffer> = new Map();

	// Parse each part
	for (let i = 0; i < positions.length - 1; i++) {
		const start = positions[i] + boundaryBytes.length;
		const end = positions[i + 1];

		// Check for closing boundary marker
		if (bytes[start] === 0x2d && bytes[start + 1] === 0x2d) break;

		const partBytes = bytes.slice(start, end);
		const partStr = decoder.decode(partBytes);

		// Split headers from body at \r\n\r\n
		const headerEnd = partStr.indexOf('\r\n\r\n');
		if (headerEnd === -1) continue;

		const headerStr = partStr.slice(0, headerEnd);
		const bodyOffset = start + new TextEncoder().encode(partStr.slice(0, headerEnd + 4)).length;
		const bodyEnd = end - 2; // strip trailing \r\n

		const headers: Record<string, string> = {};
		for (const line of headerStr.split('\r\n')) {
			const colonIdx = line.indexOf(':');
			if (colonIdx > 0) {
				const key = line.slice(0, colonIdx).trim().toLowerCase();
				const value = line.slice(colonIdx + 1).trim();
				headers[key] = value;
			}
		}

		if (headers['content-type'] === 'application/json') {
			const jsonStr = decoder.decode(bytes.slice(bodyOffset, bodyEnd));
			jsonData = JSON.parse(jsonStr);
		} else {
			const variantName = headers['x-variant-name'];
			if (variantName) {
				binaryParts.set(variantName, bytes.slice(bodyOffset, bodyEnd).buffer);
			}
		}
	}

	if (!jsonData) {
		throw createError('INTERNAL_ERROR', { details: 'No JSON part in container response' });
	}

	// Merge binary data with variant metadata
	const variants: ContainerOutputVariant[] = (jsonData.variants ?? []).map((v: any) => ({
		name: v.name,
		mime_type: v.mime_type,
		width: v.width,
		height: v.height,
		file_size: v.file_size,
		is_animated: v.is_animated ?? false,
		fit: v.fit,
		watermarked: v.watermarked ?? false,
		data: binaryParts.get(v.name) ?? new ArrayBuffer(0),
	}));

	return {
		metadata: jsonData.metadata,
		thumbhash: jsonData.thumbhash,
		variants,
	};
}

/**
 * ImageProcessorContainer — Cloudflare Container DO that bridges Workers to the Docker container.
 * Exposes a process() RPC method for sending image bytes and receiving processed results.
 */
export class ImageProcessorContainer extends Container {
	defaultPort = 8080;
	sleepAfter = '5m';
	enableInternet = false;

	/**
	 * Process an image via the Docker container.
	 * Pre-fetches watermark images (container has no internet), then forwards
	 * image bytes to the container and parses the multipart response.
	 */
	async process(
		imageData: ArrayBuffer,
		options?: ContainerProcessOptions,
	): Promise<ContainerProcessResult> {
		// Pre-fetch watermark images
		const watermarkImages = await this.fetchWatermarkImages(options);

		// Build options to send to container
		const containerOptions: Record<string, unknown> = {
			variants: options?.variants,
			compress_original: options?.compress_original,
			avatar: options?.avatar,
		};

		// Include pre-fetched watermark images as base64
		if (watermarkImages && watermarkImages.size > 0) {
			const encoded: Record<string, string> = {};
			for (const [key, value] of watermarkImages) {
				encoded[key] = btoa(String.fromCharCode(...new Uint8Array(value)));
			}
			containerOptions.watermark_images = encoded;
		}

		try {
			const port = this.ctx.container!.getTcpPort(8080);
			const response = await port.fetch('http://localhost/process', {
				method: 'POST',
				body: imageData,
				headers: {
					'X-Options': btoa(JSON.stringify(containerOptions)),
				},
			});

			if (!response.ok) {
				let error: any;
				try {
					error = await response.json();
				} catch {
					throw createError('INTERNAL_ERROR', { status: response.status });
				}
				// Normalize details to Record<string, unknown> (container may send a string)
				const details = typeof error.details === 'string'
					? { message: error.details }
					: (error.details ?? {});
				throw createError(error.code ?? 'INTERNAL_ERROR', details);
			}

			return parseMultipartResponse(response);
		} catch (err: any) {
			// If it's already one of our errors, re-throw
			if (err?.name === 'ImageProcessorError' || err?.name === 'ValidationError' || err?.name === 'ProcessingError' || err?.name === 'TimeoutError') {
				throw err;
			}
			// Connection or startup failure
			throw createError('CONTAINER_UNAVAILABLE', {
				message: err?.message ?? String(err),
			});
		}
	}

	/** Pre-fetch watermark images that the container can't access (no internet) */
	private async fetchWatermarkImages(
		options?: ContainerProcessOptions,
	): Promise<Map<string, ArrayBuffer> | undefined> {
		if (!options?.variants) return undefined;

		const imagePaths = new Set<string>();
		for (const v of options.variants) {
			if (v.watermark?.image) imagePaths.add(v.watermark.image);
		}
		if (imagePaths.size === 0) return undefined;

		const result = new Map<string, ArrayBuffer>();
		for (const path of imagePaths) {
			if (path.startsWith('http://') || path.startsWith('https://')) {
				const res = await fetch(path);
				if (res.ok) result.set(path, await res.arrayBuffer());
			} else if (options.bucket) {
				const obj = await options.bucket.get(path);
				if (obj) result.set(path, await obj.arrayBuffer());
			}
		}
		return result.size > 0 ? result : undefined;
	}
}
