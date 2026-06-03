import sharp from 'sharp';
import type { MetadataResult } from './metadata';

/**
 * Face-aware square crop for avatar/profile pictures.
 *
 * Detects faces using a lightweight approach and crops to a square
 * centered on the largest face. Falls back to Sharp's attention-based
 * crop if no face is detected.
 *
 * Note: Face detection via @mediapipe/tasks-vision is optional.
 * If unavailable, falls back directly to attention-based crop.
 */

interface FaceDetection {
	boundingBox?: {
		originX: number;
		originY: number;
		width: number;
		height: number;
	};
}

interface FaceDetectorLike {
	// MediaPipe accepts TexImageSource | ImageData-like objects at runtime
	detect(image: unknown): { detections: FaceDetection[] };
}

let faceDetector: FaceDetectorLike | null = null;
let faceDetectionAvailable: boolean | null = null;

/** Initialize face detection (called once at startup) */
export async function initFaceDetector(): Promise<void> {
	try {
		const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
		// Resolve WASM directory dynamically (works regardless of CWD)
		const resolved = import.meta.resolve('@mediapipe/tasks-vision');
		const wasmDir = new URL('./wasm', resolved).pathname;
		const modelPath = new URL('./wasm/blaze_face_short_range.tflite', resolved).pathname;

		const vision = await FilesetResolver.forVisionTasks(wasmDir);
		faceDetector = await FaceDetector.createFromOptions(vision, {
			baseOptions: { modelAssetPath: modelPath },
			runningMode: 'IMAGE',
		});
		faceDetectionAvailable = true;
	} catch {
		// MediaPipe not available — fall back to attention crop
		faceDetectionAvailable = false;
	}
}

/** Attention-based fallback crop (uses Sharp's saliency detection) */
async function fallbackCrop(input: Buffer, metadata: MetadataResult): Promise<Buffer> {
	const size = Math.min(metadata.width, metadata.height);
	return sharp(input)
		.resize(size, size, {
			fit: 'cover',
			position: 'attention',
		})
		.toBuffer();
}

/**
 * Perform face-aware square crop.
 * Returns a new Buffer containing the cropped square image.
 */
export async function faceCrop(input: Buffer, metadata: MetadataResult): Promise<Buffer> {
	// If face detection isn't available, use attention crop
	if (faceDetectionAvailable === null) {
		await initFaceDetector();
	}

	if (!faceDetectionAvailable || !faceDetector) {
		return fallbackCrop(input, metadata);
	}

	try {
		// Resize to max 1024px for faster detection
		const preview = await sharp(input)
			.resize(1024, 1024, { fit: 'inside' })
			.raw()
			.toBuffer({ resolveWithObject: true });

		const scaleX = metadata.width / preview.info.width;
		const scaleY = metadata.height / preview.info.height;

		// Run face detection
		const result = faceDetector.detect({
			data: new Uint8ClampedArray(preview.data),
			width: preview.info.width,
			height: preview.info.height,
		});

		if (!result.detections || result.detections.length === 0) {
			return fallbackCrop(input, metadata);
		}

		// Find the largest face by bounding box area
		const largest = result.detections.reduce((a: FaceDetection, b: FaceDetection) => {
			const areaA = (a.boundingBox?.width ?? 0) * (a.boundingBox?.height ?? 0);
			const areaB = (b.boundingBox?.width ?? 0) * (b.boundingBox?.height ?? 0);
			return areaA > areaB ? a : b;
		});

		if (!largest.boundingBox) {
			return fallbackCrop(input, metadata);
		}

		// Scale bounding box back to original image coordinates
		const faceCenter = {
			x: (largest.boundingBox.originX + largest.boundingBox.width / 2) * scaleX,
			y: (largest.boundingBox.originY + largest.boundingBox.height / 2) * scaleY,
		};

		// Compute square crop region centered on face
		const squareSide = Math.min(metadata.width, metadata.height);
		let left = Math.round(faceCenter.x - squareSide / 2);
		let top = Math.round(faceCenter.y - squareSide / 2);

		// Clamp to image bounds
		left = Math.max(0, Math.min(left, metadata.width - squareSide));
		top = Math.max(0, Math.min(top, metadata.height - squareSide));

		// Extract square region
		return sharp(input)
			.extract({
				left,
				top,
				width: squareSide,
				height: squareSide,
			})
			.toBuffer();
	} catch {
		// Any detection failure → fall back to attention crop
		return fallbackCrop(input, metadata);
	}
}

/** Avatar defaults applied when avatar: true */
export const AVATAR_DEFAULTS = {
	keep_original: false,
	compress_original: false,
	variants: [
		{
			name: 'thumbnail',
			max_dimension: 640,
			format: 'avif' as const,
			quality: 50,
			effort: 4,
			fit: 'cover' as const,
		},
	],
};
