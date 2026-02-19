import { Container } from '@cloudflare/containers';
import type { VariantConfig, ContainerProcessResult, ContainerOutputVariant, ImageMetadata, ErrorCode } from './types';
import { createError } from './errors';

const BOUNDARY = '----imgproc';
const RPC_TIMEOUT_MS = 120_000;

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

	interface RawVariantJson {
		name: string;
		mime_type: string;
		width: number;
		height: number;
		file_size: number;
		is_animated?: boolean;
		fit?: 'inside' | 'cover';
		watermarked?: boolean;
	}

	interface ContainerJsonData {
		metadata: ImageMetadata;
		thumbhash: string;
		variants: RawVariantJson[];
	}

	let jsonData: ContainerJsonData | null = null;
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
	const variants: ContainerOutputVariant[] = (jsonData.variants ?? []).map((v: RawVariantJson) => {
		const data = binaryParts.get(v.name);
		if (!data || data.byteLength === 0) {
			throw createError('INTERNAL_ERROR', {
				message: `Missing binary data for variant '${v.name}' in container response`,
			});
		}
		return {
			name: v.name,
			mime_type: v.mime_type,
			width: v.width,
			height: v.height,
			file_size: v.file_size,
			is_animated: v.is_animated ?? false,
			fit: v.fit,
			watermarked: v.watermarked ?? false,
			data,
		};
	});

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

	/** Encode an ArrayBuffer to base64 without exceeding max call stack size */
	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		const chunks: string[] = [];
		const chunkSize = 32768;
		for (let i = 0; i < bytes.length; i += chunkSize) {
			chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
		}
		return btoa(chunks.join(''));
	}

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
				encoded[key] = this.arrayBufferToBase64(value);
			}
			containerOptions.watermark_images = encoded;
		}

		try {
			const port = this.ctx.container!.getTcpPort(8080);
			const abortController = new AbortController();
			const timeoutId = setTimeout(() => abortController.abort(), RPC_TIMEOUT_MS);

			let response: Response;
			try {
				response = await port.fetch('http://localhost/process', {
					method: 'POST',
					body: imageData,
					headers: {
						'X-Options': btoa(JSON.stringify(containerOptions)),
					},
					signal: abortController.signal,
				});
			} finally {
				clearTimeout(timeoutId);
			}

			if (!response.ok) {
				let errorBody: { code?: string; details?: string | Record<string, unknown> };
				try {
					errorBody = await response.json() as { code?: string; details?: string | Record<string, unknown> };
				} catch {
					throw createError('INTERNAL_ERROR', { status: response.status });
				}
				// Normalize details to Record<string, unknown> (container may send a string)
				const details = typeof errorBody.details === 'string'
					? { message: errorBody.details }
					: (errorBody.details ?? {});
				throw createError((errorBody.code ?? 'INTERNAL_ERROR') as ErrorCode, details);
			}

			return parseMultipartResponse(response);
		} catch (err: unknown) {
			// If it's already one of our errors, re-throw
			if (err instanceof Error && ['ImageProcessorError', 'ValidationError', 'ProcessingError', 'TimeoutError'].includes(err.name)) {
				throw err;
			}
			// Connection or startup failure
			throw createError('CONTAINER_UNAVAILABLE', {
				message: err instanceof Error ? err.message : String(err),
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
