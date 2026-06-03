/**
 * End-to-end integration test: Mode 2
 * standalone processImage() → result
 *
 * Tests processImage() with mocked R2 and Container DO.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processImage } from '../src/process';

// ── Mock R2 Bucket ──────────────────────────────────────────────────────────

function createMockBucket(initialObjects: Record<string, ArrayBuffer> = {}) {
	const store = new Map<
		string,
		{ data: any; httpMetadata?: any; customMetadata?: any }
	>();

	for (const [key, data] of Object.entries(initialObjects)) {
		store.set(key, { data });
	}

	return {
		_store: store,
		async put(key: string, data: any, options?: any) {
			store.set(key, {
				data,
				httpMetadata: options?.httpMetadata,
				customMetadata: options?.customMetadata,
			});
		},
		async get(key: string) {
			const obj = store.get(key);
			if (!obj) return null;
			return {
				body: obj.data,
				httpEtag: `"${key}-etag"`,
				httpMetadata: obj.httpMetadata ?? {},
				customMetadata: obj.customMetadata ?? {},
				arrayBuffer: async () =>
					obj.data instanceof ArrayBuffer
						? obj.data
						: new TextEncoder().encode(String(obj.data)).buffer,
			};
		},
		async delete(key: string) {
			store.delete(key);
		},
	};
}

// ── Fake container result ───────────────────────────────────────────────────

const FAKE_RESULT = {
	metadata: {
		file_name: 'landscape.jpg',
		file_extension: 'jpg',
		mime_type: 'image/jpeg',
		file_size: 1024000,
		width: 4000,
		height: 3000,
		aspect_ratio: 1.333,
		has_transparency: false,
		is_animated: false,
		frame_count: 1,
		color_space: 'srgb',
		bit_depth: 8,
		channels: 3,
		background_color: { l: 0.7, c: 0.03, h: 180 },
		background_color_css: 'oklch(0.7 0.03 180)',
		accent_color: { l: 0.5, c: 0.18, h: 120 },
		accent_color_css: 'oklch(0.5 0.18 120)',
		luminance: 0.7,
		date_taken: null,
		gps_latitude: 48.8566,
		gps_longitude: 2.3522,
		exif_orientation: 1,
		has_icc_profile: false,
	},
	thumbhash: 'IQgSLYZ6iHePh4h1eFeHd4ePgHg=',
	variants: [
		{
			name: 'default',
			mime_type: 'image/avif',
			width: 2048,
			height: 1536,
			file_size: 120000,
			is_animated: false,
			fit: 'inside',
			watermarked: false,
			data: new ArrayBuffer(120000),
		},
		{
			name: 'thumbnail',
			mime_type: 'image/avif',
			width: 640,
			height: 480,
			file_size: 30000,
			is_animated: false,
			fit: 'cover',
			watermarked: false,
			data: new ArrayBuffer(30000),
		},
		{
			name: 'original',
			mime_type: 'image/avif',
			width: 4000,
			height: 3000,
			file_size: 800000,
			is_animated: false,
			data: new ArrayBuffer(800000),
		},
	],
};

function createMockBinding(result: any) {
	return {
		getByName: vi.fn(() => ({
			process: vi.fn(async () => result),
		})),
	};
}

describe('Mode 2: standalone processImage()', () => {
	let bucket: any;
	let binding: any;

	beforeEach(() => {
		bucket = createMockBucket({
			'photos/landscape.jpg': new ArrayBuffer(1024000),
		});
		binding = createMockBinding(FAKE_RESULT);
	});

	it('processes an image and returns full result', async () => {
		const result = await processImage(binding, {
			bucket,
			key: 'photos/landscape.jpg',
		});

		// Result structure
		expect(result.ok).toBe(true);
		expect(result.job_id).toBeTruthy();
		expect(result.metadata.width).toBe(4000);
		expect(result.metadata.height).toBe(3000);
		expect(result.metadata.mime_type).toBe('image/jpeg');
		expect(result.thumbhash).toBe('IQgSLYZ6iHePh4h1eFeHd4ePgHg=');

		// Variants
		expect(result.variants).toHaveLength(3);
		expect(result.variants[0].name).toBe('default');
		expect(result.variants[0].key).toBe('photos/default');
		expect(result.variants[0].width).toBe(2048);
		expect(result.variants[1].name).toBe('thumbnail');
		expect(result.variants[1].key).toBe('photos/thumbnail');
		expect(result.variants[2].name).toBe('original');
		expect(result.variants[2].key).toBe('photos/original');
	});

	it('writes variants to R2 with correct metadata', async () => {
		await processImage(binding, {
			bucket,
			key: 'photos/landscape.jpg',
		});

		// Check default variant
		const defaultObj = bucket._store.get('photos/default');
		expect(defaultObj).toBeTruthy();
		expect(defaultObj.httpMetadata.contentType).toBe('image/avif');
		expect(defaultObj.httpMetadata.cacheControl).toBe(
			'public, max-age=31536000, immutable',
		);
		expect(defaultObj.customMetadata.width).toBe('2048');
		expect(defaultObj.customMetadata.height).toBe('1536');

		// Check thumbnail variant
		const thumbObj = bucket._store.get('photos/thumbnail');
		expect(thumbObj).toBeTruthy();
		expect(thumbObj.customMetadata.width).toBe('640');
		expect(thumbObj.customMetadata.height).toBe('480');

		// Check original variant has original-filename
		const origObj = bucket._store.get('photos/original');
		expect(origObj).toBeTruthy();
		expect(origObj.customMetadata['original-filename']).toBe('landscape.jpg');
	});

	it('keeps original upload by default', async () => {
		await processImage(binding, {
			bucket,
			key: 'photos/landscape.jpg',
		});

		// Original upload should still exist
		expect(bucket._store.has('photos/landscape.jpg')).toBe(true);
	});

	it('deletes original when keep_original is false', async () => {
		await processImage(binding, {
			bucket,
			key: 'photos/landscape.jpg',
			keep_original: false,
		});

		// Original upload should be deleted
		expect(bucket._store.has('photos/landscape.jpg')).toBe(false);
		// But processed variants should still exist
		expect(bucket._store.has('photos/default')).toBe(true);
		expect(bucket._store.has('photos/thumbnail')).toBe(true);
	});

	it('throws FILE_NOT_FOUND for missing R2 object', async () => {
		await expect(
			processImage(binding, {
				bucket,
				key: 'nonexistent/image.jpg',
			}),
		).rejects.toThrow();

		try {
			await processImage(binding, {
				bucket,
				key: 'nonexistent/image.jpg',
			});
		} catch (err: any) {
			expect(err.code).toBe('FILE_NOT_FOUND');
		}
	});

	it('passes options to the container', async () => {
		const customVariants = [{ name: 'large', max_dimension: 4096, format: 'webp' }];

		await processImage(binding, {
			bucket,
			key: 'photos/landscape.jpg',
			variants: customVariants,
			compress_original: false,
			avatar: true,
		});

		const stub = binding.getByName.mock.results[0].value;
		expect(stub.process).toHaveBeenCalledWith(
			expect.any(ArrayBuffer),
			expect.objectContaining({
				variants: customVariants,
				compress_original: false,
				avatar: true,
			}),
		);
	});

	it('output variants have no binary data', async () => {
		const result = await processImage(binding, {
			bucket,
			key: 'photos/landscape.jpg',
		});

		// OutputVariant should have key but no data
		for (const v of result.variants) {
			expect(v.key).toBeTruthy();
			expect(v.name).toBeTruthy();
			expect((v as any).data).toBeUndefined();
		}
	});

	it('handles watermarked variants correctly', async () => {
		const resultWithWatermark = {
			...FAKE_RESULT,
			variants: [
				{
					...FAKE_RESULT.variants[0],
					watermarked: true,
				},
				FAKE_RESULT.variants[1],
			],
		};
		binding = createMockBinding(resultWithWatermark);

		const result = await processImage(binding, {
			bucket,
			key: 'photos/landscape.jpg',
		});

		expect(result.variants[0].watermarked).toBe(true);
		expect(result.variants[1].watermarked).toBeUndefined();
	});

	it('derives base path from key correctly', async () => {
		bucket._store.set('user/123/uploads/photo.jpg', {
			data: new ArrayBuffer(100),
		});
		const getBucket = bucket.get;
		bucket.get = async (key: string) => {
			const obj = bucket._store.get(key);
			if (!obj) return null;
			return {
				body: obj.data,
				arrayBuffer: async () =>
					obj.data instanceof ArrayBuffer ? obj.data : new ArrayBuffer(0),
			};
		};

		await processImage(binding, {
			bucket,
			key: 'user/123/uploads/photo.jpg',
		});

		// Variants should be written to user/123/uploads/{variant_name}
		expect(bucket._store.has('user/123/uploads/default')).toBe(true);
		expect(bucket._store.has('user/123/uploads/thumbnail')).toBe(true);
	});
});
