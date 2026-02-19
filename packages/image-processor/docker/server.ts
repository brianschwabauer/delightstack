import { process } from './pipeline';

const BOUNDARY = '----imgproc';
const TIMEOUT_MS = 60_000;

/** Encode a multipart/mixed response from JSON metadata + binary variant parts */
function encodeMultipart(
	json: Record<string, unknown>,
	binaryParts: { name: string; mime_type: string; data: ArrayBuffer }[],
): { body: Uint8Array; content_type: string } {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];

	// JSON part
	const jsonStr = JSON.stringify(json);
	const jsonHeader = `--${BOUNDARY}\r\nContent-Type: application/json\r\n\r\n`;
	parts.push(encoder.encode(jsonHeader));
	parts.push(encoder.encode(jsonStr));
	parts.push(encoder.encode('\r\n'));

	// Binary parts
	for (const part of binaryParts) {
		const header = `--${BOUNDARY}\r\nContent-Type: ${part.mime_type}\r\nX-Variant-Name: ${part.name}\r\n\r\n`;
		parts.push(encoder.encode(header));
		parts.push(new Uint8Array(part.data));
		parts.push(encoder.encode('\r\n'));
	}

	// Closing boundary
	parts.push(encoder.encode(`--${BOUNDARY}--\r\n`));

	// Concatenate all parts
	const total_length = parts.reduce((sum, p) => sum + p.byteLength, 0);
	const body = new Uint8Array(total_length);
	let offset = 0;
	for (const part of parts) {
		body.set(part, offset);
		offset += part.byteLength;
	}

	return {
		body,
		content_type: `multipart/mixed; boundary=${BOUNDARY}`,
	};
}

/** Wrap a promise with a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => {
				const err = Object.assign(new Error(`Processing timed out after ${ms}ms`), {
					code: 'PROCESSING_TIMEOUT',
					details: { timeout_ms: ms },
				});
				reject(err);
			}, ms),
		),
	]);
}

/** Deserialize watermark_images from base64 strings to Map<string, ArrayBuffer> */
function deserializeWatermarkImages(raw: Record<string, string>): Map<string, ArrayBuffer> {
	const map = new Map<string, ArrayBuffer>();
	for (const [key, base64] of Object.entries(raw)) {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		map.set(key, bytes.buffer);
	}
	return map;
}

Bun.serve({
	port: 8080,
	async fetch(request) {
		const url = new URL(request.url);

		// Health check
		if (url.pathname === '/health' && request.method === 'GET') {
			return new Response('OK', { status: 200 });
		}

		// Process endpoint
		if (url.pathname === '/process' && request.method === 'POST') {
			try {
				const imageData = await request.arrayBuffer();

				// Parse options from X-Options header (base64-encoded JSON)
				let options: Record<string, unknown> = {};
				const optionsHeader = request.headers.get('X-Options');
				if (optionsHeader) {
					options = JSON.parse(atob(optionsHeader));
				}

				// Deserialize watermark_images from base64 strings to Map<string, ArrayBuffer>
				if (options.watermark_images && typeof options.watermark_images === 'object') {
					options.watermark_images = deserializeWatermarkImages(
						options.watermark_images as Record<string, string>,
					);
				}

				// Process with timeout
				const result = await withTimeout(process(imageData, options), TIMEOUT_MS);

				// Build multipart response
				const jsonPart = {
					metadata: result.metadata,
					thumbhash: result.thumbhash,
					variants: result.variants.map((v: any) => ({
						name: v.name,
						mime_type: v.mime_type,
						width: v.width,
						height: v.height,
						file_size: v.file_size,
						is_animated: v.is_animated,
						fit: v.fit,
						watermarked: v.watermarked,
					})),
				};

				const binaryParts = result.variants.map((v: any) => ({
					name: v.name,
					mime_type: v.mime_type,
					data: v.data,
				}));

				const { body, content_type } = encodeMultipart(jsonPart, binaryParts);

				return new Response(body, {
					status: 200,
					headers: { 'Content-Type': content_type },
				});
			} catch (error: any) {
				const code = error?.code ?? 'INTERNAL_ERROR';
				const status =
					code === 'PROCESSING_TIMEOUT' ? 504
					: code === 'INTERNAL_ERROR' ? 500
					: 400;

				return Response.json(
					{ code, details: error?.details ?? error?.message ?? String(error) },
					{ status },
				);
			}
		}

		return new Response('Not Found', { status: 404 });
	},
});

console.log('Image processor container listening on port 8080');
