/**
 * EXIF capture then strip — the privacy contract, pinned against the real
 * pipeline (real sharp, real encoders, no mocks).
 *
 * Capture: GPS and `DateTimeOriginal` are extracted into the metadata result,
 * with `date_taken` always canonical UTC ISO 8601 (`OffsetTimeOriginal`
 * applied when readable, never a passthrough of the EXIF spelling) — consumers
 * compare the stored string lexicographically against UTC boundaries.
 *
 * Strip: the resized variants are fresh encodes from a decoded intermediate
 * and carry no EXIF/XMP/IPTC at all. The one encode path that preserves
 * metadata is the compressed 'original' (`keepMetadata()`), gated on
 * `compress_original && keep_original` — so a `keep_original: false` caller
 * gets variants with nothing to leak, and the flag must reach the container
 * (the boundary bug these tests hold shut).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { extractMetadata } from '../container/src/metadata';
import { process } from '../container/src/pipeline';

// The container's own dependency tree owns sharp (the package root has no
// copy); resolve it exactly the way `container/src/*` does at runtime.
const requireFromContainer = createRequire(
	new URL('../container/src/pipeline.ts', import.meta.url),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = requireFromContainer('sharp') as typeof import('sharp').default;

/**
 * Splice an XMP APP1 segment into a JPEG, right after SOI. sharp 0.33 can
 * write EXIF but not XMP, and a strip assertion over metadata that was never
 * present is vacuous — the fixture must actually carry all it claims to.
 */
function withXmpPacket(jpeg: Buffer): Buffer {
	const namespace = 'http://ns.adobe.com/xap/1.0/\0';
	const packet =
		'<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
		'<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
		'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
		'<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">' +
		'<dc:creator><rdf:Seq><rdf:li>Probe Author</rdf:li></rdf:Seq></dc:creator>' +
		'</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
	const payload = Buffer.concat([
		Buffer.from(namespace, 'utf8'),
		Buffer.from(packet, 'utf8'),
	]);
	const header = Buffer.alloc(4);
	header[0] = 0xff;
	header[1] = 0xe1; // APP1
	header.writeUInt16BE(payload.length + 2, 2); // length includes its own bytes
	return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

/** A JPEG carrying GPS + capture time + an XMP packet, built with real encoders. */
async function exifJpeg(photo_ifd: Record<string, string> = {}): Promise<Buffer> {
	const encoded = await sharp({
		create: { width: 64, height: 48, channels: 3, background: '#3366aa' },
	})
		.jpeg()
		.withExif({
			IFD0: { Make: 'ProbeCam' },
			IFD2: { DateTimeOriginal: '2019:06:12 14:03:00', ...photo_ifd },
			// libvips IFD3 is the GPS IFD: 38°4'12.34"N, 122°52'45.67"W
			IFD3: {
				GPSLatitudeRef: 'N',
				GPSLatitude: '38/1 4/1 1234/100',
				GPSLongitudeRef: 'W',
				GPSLongitude: '122/1 52/1 4567/100',
			},
		})
		.toBuffer();
	return withXmpPacket(encoded);
}

const MIME = { mime_type: 'image/jpeg', extension: 'jpg' };

/** The delightwrite-shaped variant list: nothing named 'original'. */
const TWO_VARIANTS = [
	{ name: 'default', max_dimension: 2048, format: 'avif' as const, quality: 50 },
	{ name: 'thumbnail', max_dimension: 640, format: 'avif' as const, quality: 50 },
];

describe('EXIF capture', () => {
	it('extracts GPS as decimal degrees and DateTimeOriginal as UTC ISO 8601', async () => {
		const jpeg = await exifJpeg();
		const meta = await extractMetadata(jpeg, MIME, jpeg.byteLength);
		expect(meta.gps_latitude).toBeCloseTo(38 + 4 / 60 + 12.34 / 3600, 5);
		expect(meta.gps_longitude).toBeCloseTo(-(122 + 52 / 60 + 45.67 / 3600), 5);
		// No OffsetTimeOriginal: the wall clock stamped as UTC is the best
		// available reading.
		expect(meta.date_taken).toBe('2019-06-12T14:03:00.000Z');
	});

	it('applies OffsetTimeOriginal — a +02:00 wall clock is two hours ahead of UTC', async () => {
		const jpeg = await exifJpeg({ OffsetTimeOriginal: '+02:00' });
		const meta = await extractMetadata(jpeg, MIME, jpeg.byteLength);
		expect(meta.date_taken).toBe('2019-06-12T12:03:00.000Z');
	});

	it('applies a negative offset the other way', async () => {
		const jpeg = await exifJpeg({ OffsetTimeOriginal: '-07:00' });
		const meta = await extractMetadata(jpeg, MIME, jpeg.byteLength);
		expect(meta.date_taken).toBe('2019-06-12T21:03:00.000Z');
	});

	it('treats an unreadable or impossible offset as absent, never as a guess', async () => {
		// (An empty string cannot be embedded — sharp refuses it at write time.)
		for (const offset of ['+99:00', '+02:99', 'PST', '0200']) {
			const jpeg = await exifJpeg({ OffsetTimeOriginal: offset });
			const meta = await extractMetadata(jpeg, MIME, jpeg.byteLength);
			expect(meta.date_taken).toBe('2019-06-12T14:03:00.000Z');
		}
	});

	it('an image with no EXIF captures nothing and stores nothing', async () => {
		const plain = await sharp({
			create: { width: 32, height: 32, channels: 3, background: '#222222' },
		})
			.jpeg()
			.toBuffer();
		const meta = await extractMetadata(plain, MIME, plain.byteLength);
		expect(meta.date_taken).toBeNull();
		expect(meta.gps_latitude).toBeNull();
		expect(meta.gps_longitude).toBeNull();
	});
});

describe('EXIF strip', () => {
	it('keep_original:false emits only the configured variants, each with zero metadata', async () => {
		const jpeg = await exifJpeg({ OffsetTimeOriginal: '+02:00' });
		// The absence assertions below are only as strong as the presence here:
		// the fixture really does carry both EXIF and an XMP packet going in.
		const input_meta = await sharp(jpeg).metadata();
		expect(input_meta.exif).toBeDefined();
		expect(input_meta.xmp).toBeDefined();
		const result = await process(
			jpeg.buffer.slice(
				jpeg.byteOffset,
				jpeg.byteOffset + jpeg.byteLength,
			) as ArrayBuffer,
			{
				variants: TWO_VARIANTS,
				compress_original: true,
				keep_original: false,
			},
		);

		// The record still knows where and when — capture happened first.
		expect(result.metadata.gps_latitude).not.toBeNull();
		expect(result.metadata.date_taken).toBe('2019-06-12T12:03:00.000Z');

		// No fabricated 'original': the one metadata-preserving encode path
		// is gated on compress_original && keep_original.
		expect(result.variants.map((variant) => variant.name).sort()).toEqual([
			'default',
			'thumbnail',
		]);

		// And the stored bytes carry nothing — EXIF, XMP, IPTC all absent.
		for (const variant of result.variants) {
			const out = await sharp(Buffer.from(variant.data)).metadata();
			expect(out.exif, `${variant.name} exif`).toBeUndefined();
			expect(out.xmp, `${variant.name} xmp`).toBeUndefined();
			expect(out.iptc, `${variant.name} iptc`).toBeUndefined();
		}
	});

	it('keep_original:true is the deliberate exception — the compressed original keeps its EXIF', async () => {
		const jpeg = await exifJpeg();
		const result = await process(
			jpeg.buffer.slice(
				jpeg.byteOffset,
				jpeg.byteOffset + jpeg.byteLength,
			) as ArrayBuffer,
			{
				variants: TWO_VARIANTS,
				compress_original: true,
				keep_original: true,
			},
		);
		const original = result.variants.find((variant) => variant.name === 'original');
		expect(original).toBeDefined();
		const out = await sharp(Buffer.from(original!.data)).metadata();
		// keepMetadata() preserved the block — which is exactly why a caller
		// discarding originals must say so across the container boundary.
		expect(out.exif).toBeDefined();
		// The resized variants still strip regardless of keep_original.
		for (const variant of result.variants) {
			if (variant.name === 'original') continue;
			const stripped = await sharp(Buffer.from(variant.data)).metadata();
			expect(stripped.exif, `${variant.name} exif`).toBeUndefined();
		}
	});
});
