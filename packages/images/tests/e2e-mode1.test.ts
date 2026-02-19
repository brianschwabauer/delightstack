/**
 * End-to-end integration test: Mode 1
 * upload → alarm → processed → CDN → component
 *
 * Tests the full lifecycle with mocked R2, Container DO, and database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageProcessing } from '../src/integration';
import { createImageHandle } from '../src/handle';

// ── Mock R2 Bucket ──────────────────────────────────────────────────────────

function createMockBucket() {
	const store = new Map<string, { data: any; httpMetadata?: any; customMetadata?: any }>();

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
			const body = obj.data instanceof ArrayBuffer
				? new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array(obj.data));
						controller.close();
					},
				})
				: obj.data;
			return {
				body,
				httpEtag: `"${key}-etag"`,
				httpMetadata: obj.httpMetadata ?? {},
				customMetadata: obj.customMetadata ?? {},
				arrayBuffer: async () =>
					obj.data instanceof ArrayBuffer
						? obj.data
						: new TextEncoder().encode(String(obj.data)).buffer,
			};
		},
		async head(key: string) {
			const obj = store.get(key);
			if (!obj) return null;
			return {
				httpEtag: `"${key}-etag"`,
				httpMetadata: obj.httpMetadata ?? {},
				customMetadata: obj.customMetadata ?? {},
			};
		},
		async delete(key: string) {
			store.delete(key);
		},
	};
}

// ── Mock Container DO ───────────────────────────────────────────────────────

function createMockContainerNamespace(processResult: any) {
	return {
		getByName: vi.fn(() => ({
			process: vi.fn(async () => processResult),
		})),
	};
}

// ── Mock DatabaseServer ─────────────────────────────────────────────────────

let mockIdCounter = 0;

function createMockDb() {
	const records = new Map<string, any>();
	let alarmTime: number | null = null;

	return {
		_records: records,
		ctx: {
			storage: {
				getAlarm: vi.fn(async () => alarmTime),
				setAlarm: vi.fn(async (time: number) => {
					alarmTime = time;
				}),
			},
		},
		create(table: string, data: any) {
			const id = `mock_${++mockIdCounter}_${Date.now()}`;
			const now = new Date().toISOString();
			const record = { ...data, id, created_at: now, updated_at: now };
			records.set(id, record);
			return record;
		},
		get(table: string, id: string) {
			const record = records.get(id);
			if (!record) throw { status: 404, message: 'image not found' };
			return record;
		},
		update(table: string, id: string, updates: any) {
			const existing = records.get(id);
			if (!existing) throw { status: 404, message: 'image not found' };
			const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
			records.set(id, updated);
			return updated;
		},
		delete(table: string, id: string) {
			records.delete(id);
		},
		exec(sql: string, ...bindings: any[]) {
			if (sql.includes('processing_status')) {
				// Match quoted status values to avoid false matches (e.g. 'processing' in 'processing_status')
				const matchStatuses: string[] = [];
				if (sql.includes("'pending'")) matchStatuses.push('pending');
				if (sql.includes("'processing'")) matchStatuses.push('processing');
				if (sql.includes("'processed'")) matchStatuses.push('processed');
				if (sql.includes("'failed'")) matchStatuses.push('failed');

				if (sql.includes('COUNT(*)')) {
					const count = Array.from(records.values()).filter(
						(r: any) => matchStatuses.includes(r.processing_status),
					).length;
					return [{ count }];
				}
				return Array.from(records.values()).filter(
					(r: any) => matchStatuses.includes(r.processing_status),
				);
			}
			return [];
		},
	};
}

// ── Fake processing result (what the container would return) ────────────────

const FAKE_PROCESS_RESULT = {
	metadata: {
		file_name: 'photo.jpg',
		file_extension: 'jpg',
		mime_type: 'image/jpeg',
		file_size: 512000,
		width: 3000,
		height: 2000,
		aspect_ratio: 1.5,
		has_transparency: false,
		is_animated: false,
		frame_count: 1,
		color_space: 'srgb',
		bit_depth: 8,
		channels: 3,
		background_color: { l: 0.65, c: 0.04, h: 210 },
		background_color_css: 'oklch(0.65 0.04 210)',
		accent_color: { l: 0.55, c: 0.2, h: 30 },
		accent_color_css: 'oklch(0.55 0.2 30)',
		luminance: 0.65,
		date_taken: '2025-12-25T10:30:00.000Z',
		gps_latitude: null,
		gps_longitude: null,
		exif_orientation: 1,
		has_icc_profile: true,
	},
	thumbhash: 'YTkGJwaRhWUIt4lEBHhYSJdwcIA=',
	variants: [
		{
			name: 'default',
			mime_type: 'image/avif',
			width: 2048,
			height: 1365,
			file_size: 95000,
			is_animated: false,
			fit: 'inside',
			watermarked: false,
			data: new ArrayBuffer(95000),
		},
		{
			name: 'thumbnail',
			mime_type: 'image/avif',
			width: 640,
			height: 427,
			file_size: 25000,
			is_animated: false,
			fit: 'cover',
			watermarked: false,
			data: new ArrayBuffer(25000),
		},
	],
};

describe('Mode 1: upload → alarm → processed → CDN', () => {
	let bucket: any;
	let db: any;
	let containerNs: any;
	let images: ReturnType<typeof imageProcessing>;

	beforeEach(() => {
		mockIdCounter = 0;
		bucket = createMockBucket();
		containerNs = createMockContainerNamespace(FAKE_PROCESS_RESULT);
		db = createMockDb();

		images = imageProcessing(db, {
			container: () => containerNs,
			bucket: () => bucket,
			storage: db.ctx.storage,
		});
	});

	it('full lifecycle: upload → processAlarm → CDN serve', async () => {
		// ── Step 1: Upload ──────────────────────────────────────────────────
		const file = new File(['fake image data'], 'photo.jpg', {
			type: 'image/jpeg',
		});
		const record = await images.upload(file, {
			alt_text: 'Beach sunset',
		});

		// Verify pending record was created
		expect(record.processing_status).toBe('pending');
		expect(record.file_name).toBe('photo.jpg');
		expect(record.alt_text).toBe('Beach sunset');
		expect(record.id).toBeTruthy();

		// Verify original was written to R2
		const originalKey = `images/${record.id}/original`;
		const r2Original = bucket._store.get(originalKey);
		expect(r2Original).toBeTruthy();
		expect(r2Original.httpMetadata.contentType).toBe('image/jpeg');

		// Verify alarm was scheduled
		expect(db.ctx.storage.setAlarm).toHaveBeenCalled();

		// ── Step 2: Process Alarm ───────────────────────────────────────────
		await images.processAlarm();

		// Verify container was called
		expect(containerNs.getByName).toHaveBeenCalledWith('image-processor');

		// Verify record was updated to 'processed'
		const processed = db._records.get(record.id);
		expect(processed.processing_status).toBe('processed');
		expect(processed.thumbhash).toBe('YTkGJwaRhWUIt4lEBHhYSJdwcIA=');
		expect(processed.width).toBe(3000);
		expect(processed.height).toBe(2000);
		expect(processed.background_color_l).toBe(0.65);
		expect(processed.background_color_c).toBe(0.04);
		expect(processed.background_color_h).toBe(210);
		expect(processed.luminance).toBe(0.65);
		expect(processed.mime_type).toBe('image/jpeg');

		// Verify variants JSON
		const variants = JSON.parse(processed.variants);
		expect(variants).toHaveLength(2);
		expect(variants[0].name).toBe('default');
		expect(variants[0].width).toBe(2048);
		expect(variants[1].name).toBe('thumbnail');
		expect(variants[1].width).toBe(640);

		// Verify variants were written to R2
		expect(bucket._store.has(`images/${record.id}/default`)).toBe(true);
		expect(bucket._store.has(`images/${record.id}/thumbnail`)).toBe(true);

		// ── Step 3: CDN Serve ───────────────────────────────────────────────
		const handle = createImageHandle({
			bucket: () => bucket,
		});

		const resolve = vi.fn();
		const event = {
			url: new URL(`http://localhost/cdn/image/${record.id}/default`),
			request: {
				headers: {
					get: () => null,
				},
			},
		};

		const res = await handle({ event, resolve });

		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/avif');
		expect(res.headers.get('Cache-Control')).toBe(
			'public, max-age=31536000, immutable',
		);
		expect(res.headers.get('X-Image-Width')).toBe('2048');
		expect(res.headers.get('X-Image-Height')).toBe('1365');
	});

	it('upload creates a record with correct initial state', async () => {
		const data = new Uint8Array([1, 2, 3]).buffer;
		const record = await images.upload(data, {
			file_name: 'test.png',
		});

		expect(record.processing_status).toBe('pending');
		expect(record.file_name).toBe('test.png');
		expect(record.width).toBeNull();
		expect(record.height).toBeNull();
		expect(record.thumbhash).toBeNull();
		expect(record.variants).toBeNull();
	});

	it('processAlarm handles missing R2 original gracefully', async () => {
		// Upload but then delete the original from R2
		const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
		const record = await images.upload(file);

		// Remove from R2 before processing
		const originalKey = `images/${record.id}/original`;
		bucket._store.delete(originalKey);

		// processAlarm should delete the record
		await images.processAlarm();

		expect(db._records.has(record.id)).toBe(false);
	});

	it('processAlarm retries on container error, then marks failed after max retries', async () => {
		// Use a container that always throws
		const errorContainer = {
			getByName: vi.fn(() => ({
				process: vi.fn(async () => {
					const err = new Error('Processing failed');
					(err as any).code = 'CORRUPTED_FILE';
					throw err;
				}),
			})),
		};

		images = imageProcessing(db, {
			container: () => errorContainer,
			bucket: () => bucket,
			storage: db.ctx.storage,
		});

		const file = new File(['data'], 'bad.jpg', { type: 'image/jpeg' });
		const record = await images.upload(file);

		// First failure: should retry (status → pending with retry_count in _processing)
		await images.processAlarm();
		let updated = db._records.get(record.id);
		expect(updated.processing_status).toBe('pending');
		expect(updated.error_code).toBe('CORRUPTED_FILE');
		expect(JSON.parse(updated._processing).retry_count).toBe(1);

		// Exhaust retries (MAX_RETRIES = 5)
		for (let i = 1; i < 5; i++) {
			await images.processAlarm();
		}

		updated = db._records.get(record.id);
		expect(updated.processing_status).toBe('failed');
		expect(updated.error_code).toBe('CORRUPTED_FILE');
	});

	it('retry resets a failed image to pending', async () => {
		// Directly create a failed record
		db._records.set('fail1', {
			id: 'fail1',
			processing_status: 'failed',
			error_code: 'INTERNAL_ERROR',
		});

		await images.retry('fail1');

		const updated = db._records.get('fail1');
		expect(updated.processing_status).toBe('pending');
		expect(updated.error_code).toBeNull();
	});

	it('delete removes record and all R2 objects', async () => {
		// Set up a fully processed image
		const id = 'del1';
		db._records.set(id, {
			id,
			base_path: '/images',
			processing_status: 'processed',
			variants: JSON.stringify([
				{ name: 'default', width: 2048, height: 1365 },
				{ name: 'thumbnail', width: 640, height: 427 },
			]),
		});
		bucket._store.set(`images/${id}/original`, { data: 'orig' });
		bucket._store.set(`images/${id}/default`, { data: 'def' });
		bucket._store.set(`images/${id}/thumbnail`, { data: 'thumb' });

		await images.delete(id);

		// Record should be gone
		expect(db._records.has(id)).toBe(false);
		// All R2 objects should be gone
		expect(bucket._store.has(`images/${id}/original`)).toBe(false);
		expect(bucket._store.has(`images/${id}/default`)).toBe(false);
		expect(bucket._store.has(`images/${id}/thumbnail`)).toBe(false);
	});

	it('getStatus returns the current record', () => {
		db._records.set('status1', {
			id: 'status1',
			processing_status: 'processed',
		});

		const result = images.getStatus('status1');
		expect(result).toEqual({
			id: 'status1',
			processing_status: 'processed',
		});
	});

	it('getStatus returns null for missing image', () => {
		const result = images.getStatus('nonexistent');
		expect(result).toBeNull();
	});

	it('CDN returns 404 placeholder for unprocessed image', async () => {
		const handle = createImageHandle({ bucket: () => bucket });
		const resolve = vi.fn();
		const event = {
			url: new URL('http://localhost/cdn/image/pending-id/default'),
			request: { headers: { get: () => null } },
		};

		const res = await handle({ event, resolve });

		expect(res.status).toBe(404);
		expect(res.headers.get('Cache-Control')).toBe('no-cache');
		const body = await res.text();
		expect(body).toContain('Image not found');
	});

	it('CDN returns 304 for conditional request with matching ETag', async () => {
		// Put a variant in the bucket
		await bucket.put('images/abc/default', new ArrayBuffer(100), {
			httpMetadata: { contentType: 'image/avif' },
			customMetadata: { width: '1920', height: '1080' },
		});

		const handle = createImageHandle({ bucket: () => bucket });
		const resolve = vi.fn();
		const event = {
			url: new URL('http://localhost/cdn/image/abc/default'),
			request: {
				headers: {
					get: (name: string) =>
						name === 'If-None-Match' ? '"images/abc/default-etag"' : null,
				},
			},
		};

		const res = await handle({ event, resolve });

		expect(res.status).toBe(304);
	});
});
