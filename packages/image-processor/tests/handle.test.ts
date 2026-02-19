// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createImageHandle } from '../src/handle';

function createMockR2Object(overrides: any = {}) {
	return {
		body: new ReadableStream(),
		httpEtag: '"abc123"',
		httpMetadata: {
			contentType: 'image/avif',
			cacheControl: 'public, max-age=31536000, immutable',
		},
		customMetadata: {
			width: '1920',
			height: '1080',
		},
		...overrides,
	};
}

function createMockBucket(objects: Record<string, any> = {}) {
	return {
		get: vi.fn(async (key: string) => objects[key] ?? null),
		head: vi.fn(async (key: string) => objects[key] ? { httpEtag: objects[key].httpEtag } : null),
	};
}

function createMockEvent(pathname: string, headers: Record<string, string> = {}) {
	return {
		url: new URL(`http://localhost${pathname}`),
		request: {
			headers: new Map(Object.entries(headers)),
			get: (name: string) => headers[name],
		},
	};
}

// Patch the mock event to use proper Headers-like get
function patchRequestHeaders(event: any, headers: Record<string, string>) {
	event.request.headers = {
		get(name: string) {
			return headers[name.toLowerCase()] ?? headers[name] ?? null;
		},
	};
	return event;
}

describe('createImageHandle', () => {
	let bucket: any;
	let resolve: any;

	beforeEach(() => {
		bucket = createMockBucket();
		resolve = vi.fn(async () => new Response('passthrough', { status: 200 }));
	});

	function createHandle(overrides: any = {}) {
		return createImageHandle({
			bucket: () => bucket,
			...overrides,
		});
	}

	describe('request routing', () => {
		it('passes through non-CDN requests', async () => {
			const handle = createHandle();
			const event = createMockEvent('/api/users');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(resolve).toHaveBeenCalledWith(event);
			expect(await res.text()).toBe('passthrough');
		});

		it('intercepts CDN prefix requests', async () => {
			const r2Obj = createMockR2Object();
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(resolve).not.toHaveBeenCalled();
			expect(res.status).toBe(200);
		});

		it('uses custom CDN prefix', async () => {
			const handle = createHandle({ cdn_prefix: '/media' });
			const event = createMockEvent('/media/abc/default');
			patchRequestHeaders(event, {});

			await handle({ event, resolve });

			expect(resolve).not.toHaveBeenCalled();
		});

		it('passes through when path does not start with CDN prefix', async () => {
			const handle = createHandle({ cdn_prefix: '/media' });
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, {});

			await handle({ event, resolve });

			expect(resolve).toHaveBeenCalled();
		});
	});

	describe('serving images', () => {
		it('serves image with correct Content-Type', async () => {
			const r2Obj = createMockR2Object({
				httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=3600' },
			});
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.headers.get('Content-Type')).toBe('image/webp');
			expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
		});

		it('uses default immutable Cache-Control when R2 has none', async () => {
			const r2Obj = createMockR2Object({
				httpMetadata: { contentType: 'image/avif' },
			});
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
		});

		it('sets ETag header', async () => {
			const r2Obj = createMockR2Object({ httpEtag: '"xyz789"' });
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.headers.get('ETag')).toBe('"xyz789"');
		});

		it('sets X-Content-Type-Options: nosniff', async () => {
			const r2Obj = createMockR2Object();
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
		});

		it('exposes image dimensions as headers', async () => {
			const r2Obj = createMockR2Object({
				customMetadata: { width: '800', height: '600' },
			});
			bucket = createMockBucket({ 'images/abc/thumb': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/thumb');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.headers.get('X-Image-Width')).toBe('800');
			expect(res.headers.get('X-Image-Height')).toBe('600');
		});

		it('uses default variant when none specified in URL', async () => {
			const r2Obj = createMockR2Object();
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc');
			patchRequestHeaders(event, {});

			await handle({ event, resolve });

			expect(bucket.get).toHaveBeenCalledWith('images/abc/default');
		});

		it('uses custom default variant', async () => {
			const r2Obj = createMockR2Object();
			bucket = createMockBucket({ 'images/abc/large': r2Obj });
			const handle = createHandle({ default_variant: 'large' });
			const event = createMockEvent('/cdn/image/abc');
			patchRequestHeaders(event, {});

			await handle({ event, resolve });

			expect(bucket.get).toHaveBeenCalledWith('images/abc/large');
		});
	});

	describe('Content-Disposition for originals', () => {
		it('sets Content-Disposition for original variant with filename', async () => {
			const r2Obj = createMockR2Object({
				customMetadata: {
					width: '4000',
					height: '3000',
					'original-filename': 'vacation-photo.jpg',
				},
			});
			bucket = createMockBucket({ 'images/abc/original': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/original');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.headers.get('Content-Disposition')).toBe(
				'inline; filename="vacation-photo.jpg"',
			);
		});

		it('does not set Content-Disposition for non-original variants', async () => {
			const r2Obj = createMockR2Object({
				customMetadata: { width: '800', height: '600' },
			});
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.headers.get('Content-Disposition')).toBeNull();
		});
	});

	describe('conditional requests (ETag / 304)', () => {
		it('returns 304 when If-None-Match matches ETag', async () => {
			const r2Obj = createMockR2Object({ httpEtag: '"abc123"' });
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, { 'if-none-match': '"abc123"' });

			const res = await handle({ event, resolve });

			expect(res.status).toBe(304);
			expect(bucket.head).toHaveBeenCalledWith('images/abc/default');
			// Should use head() not get() for conditional requests
			expect(bucket.get).not.toHaveBeenCalled();
		});

		it('serves full response when If-None-Match does not match', async () => {
			const r2Obj = createMockR2Object({ httpEtag: '"abc123"' });
			bucket = createMockBucket({ 'images/abc/default': r2Obj });
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/default');
			patchRequestHeaders(event, { 'if-none-match': '"old-etag"' });

			const res = await handle({ event, resolve });

			expect(res.status).toBe(200);
		});
	});

	describe('404 placeholder', () => {
		it('returns SVG placeholder for missing image', async () => {
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/nonexistent/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.status).toBe(404);
			expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
			expect(res.headers.get('Cache-Control')).toBe('no-cache');
			const body = await res.text();
			expect(body).toContain('Image not found');
		});

		it('returns custom placeholder SVG', async () => {
			const customSvg = '<svg><text>Custom</text></svg>';
			const handle = createHandle({ placeholder: customSvg });
			const event = createMockEvent('/cdn/image/nonexistent/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.status).toBe(404);
			const body = await res.text();
			expect(body).toBe(customSvg);
		});

		it('returns 404 for malformed paths (empty id)', async () => {
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.status).toBe(404);
		});

		it('returns 404 for path traversal attempts', async () => {
			const handle = createHandle();
			// Use an id containing ".." (URL constructor normalizes /../ but not embedded ..)
			const event = createMockEvent('/cdn/image/..secret/default');
			patchRequestHeaders(event, {});

			const res = await handle({ event, resolve });

			expect(res.status).toBe(404);
		});
	});

	describe('R2 key construction', () => {
		it('uses default prefix "images"', async () => {
			bucket = createMockBucket();
			const handle = createHandle();
			const event = createMockEvent('/cdn/image/abc/thumb');
			patchRequestHeaders(event, {});

			await handle({ event, resolve });

			expect(bucket.get).toHaveBeenCalledWith('images/abc/thumb');
		});

		it('uses custom prefix', async () => {
			bucket = createMockBucket();
			const handle = createHandle({ prefix: 'media/photos' });
			const event = createMockEvent('/cdn/image/abc/thumb');
			patchRequestHeaders(event, {});

			await handle({ event, resolve });

			expect(bucket.get).toHaveBeenCalledWith('media/photos/abc/thumb');
		});
	});
});
