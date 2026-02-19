import sharp from 'sharp';
import { oklch, parse } from 'culori';
import { Vibrant } from 'node-vibrant/node';

export interface ColorResult {
	background_color: { l: number; c: number; h: number };
	background_color_css: string;
	accent_color: { l: number; c: number; h: number } | null;
	accent_color_css: string | null;
	luminance: number;
}

/** Convert RGB 0-255 values to a hex string */
function rgbToHex(r: number, g: number, b: number): string {
	return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Format an OKLCH color as a CSS string */
function toOklchCss(color: { l: number; c: number; h: number }): string {
	return `oklch(${color.l.toFixed(3)} ${color.c.toFixed(3)} ${color.h.toFixed(1)})`;
}

/** Convert a parsed culori color to our { l, c, h } format */
function toOklchObj(color: ReturnType<typeof oklch>): { l: number; c: number; h: number } | null {
	if (!color) return null;
	return {
		l: Math.round((color.l ?? 0) * 1000) / 1000,
		c: Math.round((color.c ?? 0) * 1000) / 1000,
		h: Math.round((color.h ?? 0) * 10) / 10,
	};
}

/**
 * Extract background color (average via 1x1 resize) and
 * accent color (most vibrant swatch via node-vibrant).
 * Returns OKLCH values and CSS strings.
 */
export async function extractColors(input: Buffer): Promise<ColorResult> {
	// Run background and accent extraction in parallel
	const [bgResult, accentResult] = await Promise.all([
		extractBackground(input),
		extractAccent(input),
	]);

	return {
		...bgResult,
		...accentResult,
	};
}

async function extractBackground(input: Buffer): Promise<{
	background_color: { l: number; c: number; h: number };
	background_color_css: string;
	luminance: number;
}> {
	const { data } = await sharp(input)
		.resize(1, 1)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const [r, g, b] = data;
	const hex = rgbToHex(r, g, b);
	const lch = oklch(parse(hex));
	const bg = toOklchObj(lch) ?? { l: 0.5, c: 0, h: 0 };

	return {
		background_color: bg,
		background_color_css: toOklchCss(bg),
		luminance: bg.l,
	};
}

async function extractAccent(input: Buffer): Promise<{
	accent_color: { l: number; c: number; h: number } | null;
	accent_color_css: string | null;
}> {
	try {
		const palette = await Vibrant.from(input).getPalette();
		const swatch =
			palette.Vibrant ??
			palette.DarkVibrant ??
			palette.LightVibrant ??
			palette.Muted;

		if (!swatch) {
			return { accent_color: null, accent_color_css: null };
		}

		const lch = oklch(parse(swatch.hex));
		const accent = toOklchObj(lch);

		return {
			accent_color: accent,
			accent_color_css: accent ? toOklchCss(accent) : null,
		};
	} catch {
		// node-vibrant can fail on very small or unusual images
		return { accent_color: null, accent_color_css: null };
	}
}
