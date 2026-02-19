import sharp from 'sharp';
import type { GeneratedVariant, VariantConfig } from './variants';

interface WatermarkConfig {
	text?: string;
	image?: string;
	layout?: 'repeat' | 'center' | 'corner';
	opacity?: number;
	rotation?: number;
	gap?: number;
	position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
	scale?: number;
}

/** Escape XML special characters to prevent SVG injection */
function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/** Create an SVG text watermark */
function createTextSvg(text: string, fontSize: number): Buffer {
	// Approximate text width: ~0.6 * fontSize * character count
	const textWidth = Math.ceil(text.length * fontSize * 0.6) + fontSize;
	const textHeight = Math.ceil(fontSize * 1.5);

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${textWidth}" height="${textHeight}">
  <style>
    text {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: ${fontSize}px;
      font-weight: 600;
      fill: white;
      fill-opacity: 1;
      filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.5));
    }
  </style>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">${escapeXml(text)}</text>
</svg>`;

	return Buffer.from(svg);
}

/** Apply opacity to a watermark buffer by multiplying alpha */
async function applyOpacity(watermarkBuffer: Buffer, opacity: number): Promise<Buffer> {
	if (opacity >= 1) return watermarkBuffer;

	return sharp(watermarkBuffer)
		.ensureAlpha()
		.composite([
			{
				input: Buffer.from([0, 0, 0, Math.round(255 * opacity)]),
				raw: { width: 1, height: 1, channels: 4 },
				tile: true,
				blend: 'dest-in',
			},
		])
		.toBuffer();
}

/** Prepare the watermark image/text buffer, scaled and with opacity */
async function prepareWatermark(
	config: WatermarkConfig,
	dimensions: { width: number; height: number },
	watermarkImages?: Map<string, ArrayBuffer>,
): Promise<Buffer> {
	let watermarkBuffer: Buffer;

	if (config.text) {
		// Text watermark: scale font size with image dimensions
		const fontSize = Math.max(16, Math.round(Math.min(dimensions.height, dimensions.width) * 0.03));
		watermarkBuffer = createTextSvg(config.text, fontSize);
	} else if (config.image && watermarkImages) {
		// Image watermark: load from pre-fetched bytes
		const imageBytes = watermarkImages.get(config.image);
		if (!imageBytes) {
			throw new Error(`Watermark image not found: ${config.image}`);
		}
		const shortEdge = Math.min(dimensions.width, dimensions.height);
		const targetSize = Math.round(shortEdge * (config.scale ?? 0.25));

		watermarkBuffer = await sharp(Buffer.from(imageBytes))
			.resize(targetSize, targetSize, { fit: 'inside' })
			.ensureAlpha()
			.toBuffer();
	} else {
		throw new Error('Watermark config must specify either text or image');
	}

	// Apply opacity
	const opacity = config.opacity ?? 0.3;
	return applyOpacity(watermarkBuffer, opacity);
}

/** Apply repeat layout: tile watermark diagonally across the image */
async function applyRepeatLayout(
	imageBuffer: Buffer,
	watermarkBuffer: Buffer,
	config: WatermarkConfig,
	dimensions: { width: number; height: number },
): Promise<Buffer> {
	const rotation = config.rotation ?? -30;
	const gap = config.gap ?? 64;

	// Get watermark dimensions
	const wmMeta = await sharp(watermarkBuffer).metadata();
	const wmWidth = wmMeta.width ?? 100;
	const wmHeight = wmMeta.height ?? 30;

	// Create a single tile (watermark + gap padding)
	const tileW = wmWidth + gap;
	const tileH = wmHeight + gap;

	const tile = await sharp({
		create: {
			width: tileW,
			height: tileH,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite([{ input: watermarkBuffer, gravity: 'centre' }])
		.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.toBuffer();

	// Composite with tiling
	return sharp(imageBuffer)
		.composite([{ input: tile, tile: true, blend: 'over' }])
		.toBuffer();
}

/** Apply center layout: single watermark in the center */
async function applyCenterLayout(
	imageBuffer: Buffer,
	watermarkBuffer: Buffer,
	config: WatermarkConfig,
): Promise<Buffer> {
	const rotation = config.rotation ?? 0;

	let wm = watermarkBuffer;
	if (rotation !== 0) {
		wm = await sharp(watermarkBuffer)
			.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.toBuffer();
	}

	return sharp(imageBuffer)
		.composite([{ input: wm, gravity: 'centre', blend: 'over' }])
		.toBuffer();
}

/** Apply corner layout: single watermark in a corner with margin */
async function applyCornerLayout(
	imageBuffer: Buffer,
	watermarkBuffer: Buffer,
	config: WatermarkConfig,
	dimensions: { width: number; height: number },
): Promise<Buffer> {
	const gravityMap: Record<string, string> = {
		'top-left': 'northwest',
		'top-right': 'northeast',
		'bottom-left': 'southwest',
		'bottom-right': 'southeast',
	};

	const position = config.position ?? 'bottom-right';
	const gravity = gravityMap[position] ?? 'southeast';
	const rotation = config.rotation ?? 0;
	const margin = 16;

	let wm = watermarkBuffer;
	if (rotation !== 0) {
		wm = await sharp(watermarkBuffer)
			.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.toBuffer();
	}

	// Add margin by extending the watermark buffer with transparent padding
	const wmMeta = await sharp(wm).metadata();
	const wmWidth = (wmMeta.width ?? 0) + margin * 2;
	const wmHeight = (wmMeta.height ?? 0) + margin * 2;

	const paddedWm = await sharp({
		create: {
			width: wmWidth,
			height: wmHeight,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		},
	})
		.composite([{ input: wm, gravity: 'centre' }])
		.toBuffer();

	return sharp(imageBuffer)
		.composite([{ input: paddedWm, gravity: gravity as any, blend: 'over' }])
		.toBuffer();
}

/**
 * Apply a watermark to a generated variant.
 * Returns a new variant with the watermark composited.
 */
export async function applyWatermark(
	variant: GeneratedVariant,
	watermarkImages?: Map<string, ArrayBuffer>,
): Promise<GeneratedVariant> {
	const config = (variant as any)._watermarkConfig as WatermarkConfig | undefined;
	if (!config) return variant;

	const dimensions = { width: variant.width, height: variant.height };
	const watermarkBuffer = await prepareWatermark(config, dimensions, watermarkImages);

	let resultBuffer: Buffer;
	const layout = config.layout ?? 'repeat';

	switch (layout) {
		case 'repeat':
			resultBuffer = await applyRepeatLayout(variant.data, watermarkBuffer, config, dimensions);
			break;
		case 'center':
			resultBuffer = await applyCenterLayout(variant.data, watermarkBuffer, config);
			break;
		case 'corner':
			resultBuffer = await applyCornerLayout(variant.data, watermarkBuffer, config, dimensions);
			break;
		default:
			resultBuffer = await applyRepeatLayout(variant.data, watermarkBuffer, config, dimensions);
	}

	return {
		...variant,
		data: resultBuffer,
		file_size: resultBuffer.byteLength,
		watermarked: true,
	};
}

/**
 * Apply watermark to a variant based on its config.
 * Called from the pipeline after variant generation.
 */
export async function applyWatermarkToVariant(
	variantData: Buffer,
	dimensions: { width: number; height: number },
	watermarkConfig: WatermarkConfig,
	watermarkImages?: Map<string, ArrayBuffer>,
): Promise<Buffer> {
	const watermarkBuffer = await prepareWatermark(watermarkConfig, dimensions, watermarkImages);

	const layout = watermarkConfig.layout ?? 'repeat';

	switch (layout) {
		case 'repeat':
			return applyRepeatLayout(variantData, watermarkBuffer, watermarkConfig, dimensions);
		case 'center':
			return applyCenterLayout(variantData, watermarkBuffer, watermarkConfig);
		case 'corner':
			return applyCornerLayout(variantData, watermarkBuffer, watermarkConfig, dimensions);
		default:
			return applyRepeatLayout(variantData, watermarkBuffer, watermarkConfig, dimensions);
	}
}
