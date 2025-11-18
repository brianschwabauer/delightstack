/* eslint-disable @typescript-eslint/no-unused-vars */
/** A color with red, green, blue values (with optional alpha) */
export interface RGB {
	r: number;
	g: number;
	b: number;
	a?: number;
}

/** A color with hue, saturation, lightness values (with optional alpha) */
export interface HSL {
	h: number;
	s: number;
	l: number;
	a?: number;
}

/** A color with lightness, chroma, and hue values */
export interface LCH {
	l: number;
	c: number;
	h: number;
}

/** The options for creating a color hash */
export interface ColorHashOptions {
	/** The minimum hue to select. @default 0 */
	minHue?: number;

	/** The maximum hue to select. @default 360 */
	maxHue?: number;

	/** The saturation (from 0 - 1) of the color. @default .25 */
	saturation?: number;

	/** The lightness/brightness (from 0 - 1) of the color. @default .5 */
	lightness?: number;

	/** The random variation (from 0 - 1) to add to the saturation/lightness. @default .2 */
	variation?: number;

	/** The random variation (from 0 - 1) to add to saturation. If not provided, uses 'variation' */
	saturationVariation?: number;

	/** The random variation (from 0 - 1) to add to lightness. If not provided, uses 'variation' */
	lightnessVariation?: number;
}

/** Returns a css color string from a hashed version of the given text string */
export function colorHash(text?: string, options?: ColorHashOptions) {
	const seed = 131;
	const seed2 = 137;
	let hash = 0;
	// make hash more sensitive for short string like 'a', 'b', 'c'
	const str = (text || '') + 'x';
	// Note: Number.MAX_SAFE_INTEGER equals 9007199254740991
	const MAX_SAFE_INTEGER = Math.floor(9007199254740991 / seed2);
	for (let i = 0; i < str.length; i++) {
		if (hash > MAX_SAFE_INTEGER) {
			hash = Math.floor(hash / seed2);
		}
		hash = hash * seed + str.charCodeAt(i);
	}
	const minHue = Math.max(0, Math.min(360, options?.minHue ?? 0));
	const maxHue = Math.max(0, Math.min(360, options?.maxHue ?? 360), minHue);
	const saturation = Math.max(0, Math.min(1, options?.saturation ?? 0.25));
	const lightness = Math.max(0, Math.min(1, options?.lightness ?? 0.5));
	const defaultVariation = options?.variation ?? 0.2;
	const saturationVariation = options?.saturationVariation ?? defaultVariation;
	const lightnessVariation = options?.lightnessVariation ?? defaultVariation;
	const lSeed = 919; // note that 919 is a prime
	const lRandom = ((hash % lSeed) / lSeed) * lightnessVariation;
	const cSeed = 359; // note that 359 is a prime
	const cRandom = ((hash % cSeed) / cSeed) * saturationVariation;
	const hueSeed = 727; // note that 727 is a prime
	const hueRandom = (hash % hueSeed) / hueSeed;
	const l = Math.max(0, Math.min(1, lightness - lightnessVariation / 2 + lRandom));
	const c = Math.max(0, Math.min(1, saturation - saturationVariation / 2 + cRandom)) / 2;
	const h = hueRandom * (maxHue - minHue) + minHue;
	return `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${h.toFixed(2)})`;
}

/** Returns true if the browser supports LCH color */
export function supportsLch() {
	return (
		typeof self !== 'undefined' &&
		'CSS' in self &&
		self.CSS.supports('color', `oklch(0 0 0)`)
	);
}

/** Returns the maximum contrast (black/white) inverted color. Useful for text color on background colors  */
export function invertColor(hex: string): '#000000' | '#FFFFFF' {
	const { r, g, b } = hexToRgb(hex);
	const brightness = (r * 255 * 299 + g * 255 * 587 + b * 255 * 114) / 1000;
	return brightness < 186 ? '#FFFFFF' : '#000000';
}

/** Converts an rgb color to a hex string like `#000000` */
export function rgbToHex(rgb: RGB): string;
export function rgbToHex(r: number, g: number, b: number): string;
export function rgbToHex(rgbArray: [number, number, number]): string;
export function rgbToHex(
	val1: number | [number, number, number] | RGB,
	val?: number,
	val3?: number,
): string {
	const [r, g, b] = Array.isArray(val1)
		? val1
		: typeof val1 === 'number'
			? ([val1, val!, val3!] as [number, number, number])
			: ([val1.r, val1.g, val1.b] as [number, number, number]);
	const red = Math.max(0, Math.min(255, Math.round(r * 255)));
	const green = Math.max(0, Math.min(255, Math.round(g * 255)));
	const blue = Math.max(0, Math.min(255, Math.round(b * 255)));
	return `#${[red, green, blue]
		.map((n) => n.toString(16).padStart(2, '0').replace('NaN', ''))
		.join('')}`;
}

/** Converts a browser rgb string like `rgba(0,0,0,0)` to a hex string like `#000000`  */
export function rgbSringToHex(rgb: string): string {
	const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+\.{0,1}\d*))?\)$/);
	if (!match) return '#000000';
	const [r, g, b] = match
		.slice(1)
		.map((n, i) => (i === 3 ? Math.round(parseFloat(n) * 255) : parseFloat(n)));
	return rgbToHex(r / 255, g / 255, b / 255);
}

/** Converts a color hex string to an RGB color */
export function hexToRgb(hex: string): RGB {
	let rgb = hex.replace('#', '');
	if (hex.length === 3) {
		rgb = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
	}
	const r = (parseInt(rgb.slice(0, 2), 16) || 0) / 255;
	const g = (parseInt(rgb.slice(2, 4), 16) || 0) / 255;
	const b = (parseInt(rgb.slice(4, 6), 16) || 0) / 255;
	return { r, g, b };
}

/** Converts the given hue, saturation, and lightness into RGB colors */
export function hslToRgb(hue: number, sat: number, light: number): RGB {
	let t2;
	hue = hue / 60;
	if (light <= 0.5) {
		t2 = light * (sat + 1);
	} else {
		t2 = light + sat - light * sat;
	}
	const t1 = light * 2 - t2;
	const hueToRgb = (v1: number, v2: number, h: number) => {
		if (h < 0) h += 6;
		if (h >= 6) h -= 6;
		if (h < 1) {
			return (v2 - v1) * h + v1;
		} else if (h < 3) {
			return v2;
		} else if (h < 4) {
			return (v2 - v1) * (4 - h) + v1;
		} else {
			return v1;
		}
	};
	const r = hueToRgb(t1, t2, hue + 2);
	const g = hueToRgb(t1, t2, hue);
	const b = hueToRgb(t1, t2, hue - 2);
	return { r, g, b };
}

/** Converts the given red, green, and blue values (0-255) into hue, saturation, lightness */
export function rgbToHsl(r: number, g: number, b: number): HSL {
	let min, max, i, s, maxcolor, h;
	const rgb = [r, g, b];
	min = rgb[0];
	max = rgb[0];
	maxcolor = 0;
	for (i = 0; i < rgb.length - 1; i++) {
		if (rgb[i + 1] <= min) {
			min = rgb[i + 1];
		}
		if (rgb[i + 1] >= max) {
			max = rgb[i + 1];
			maxcolor = i + 1;
		}
	}
	if (maxcolor === 0) h = (rgb[1] - rgb[2]) / (max - min);
	if (maxcolor === 1) h = 2 + (rgb[2] - rgb[0]) / (max - min);
	if (maxcolor === 2) h = 4 + (rgb[0] - rgb[1]) / (max - min);
	if (!h || isNaN(h)) h = 0;
	h = h * 60;
	if (h < 0) h = h + 360;
	const l = (min + max) / 2;
	if (min === max) {
		s = 0;
	} else {
		if (l < 0.5) {
			s = (max - min) / (max + min);
		} else {
			s = (max - min) / (2 - max - min);
		}
	}
	return { h, s, l };
}

/** Converts an RGB color to OKLCH values */
export function rgbToLch(rgb: RGB): LCH;
export function rgbToLch(r: number, g: number, b: number): LCH;
export function rgbToLch(rgbArray: [number, number, number]): LCH;
export function rgbToLch(
	val1: number | [number, number, number] | RGB,
	val?: number,
	val3?: number,
): LCH {
	const rgb = Array.isArray(val1)
		? val1
		: typeof val1 === 'number'
			? ([val1, val!, val3!] as [number, number, number])
			: ([val1.r, val1.g, val1.b] as [number, number, number]);
	const [l, c, h] = labToLch(xyzToLab(linearRgbToXyz(gammaRgbToLinearRgb(rgb))));
	return { l, c, h };
}

/** Converts an OKLCH color to RGB values */
export function lchToRgb(lch: LCH): RGB;
export function lchToRgb(l: number, c: number, h: number): RGB;
export function lchToRgb(lchArray: [number, number, number]): RGB;
export function lchToRgb(
	val1: number | [number, number, number] | LCH,
	val?: number,
	val3?: number,
): RGB {
	const lch = Array.isArray(val1)
		? val1
		: typeof val1 === 'number'
			? ([val1, val!, val3!] as [number, number, number])
			: ([val1.l, val1.c, val1.h] as [number, number, number]);
	// convert an array of CIE LCH values
	// to CIE Lab, and then to XYZ,
	// adapt from D50 to D65,
	// then convert XYZ to linear-light sRGB
	// and finally to gamma corrected sRGB
	// for in-gamut colors, components are in the 0.0 to 1.0 range
	// out of gamut colors may have negative components
	// or components greater than 1.0
	// so check for that :)
	const [r, g, b] = linearRgbToGammaRgb(
		xyzToLinearRgb(D50_to_D65(labToXyz(lchToLab(lch)))),
	);
	return { r, g, b };
}

/**
 * COLOR CONVERSIONS
 * https://www.w3.org/TR/css-color-4/#color-conversion-code
 * https://en.wikibooks.org/wiki/Color_Theory/Algorithms
 */

// standard white points, defined by 4-figure CIE x,y chromaticities
const D50 = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];
const D65 = [0.3127 / 0.329, 1.0, (1.0 - 0.3127 - 0.329) / 0.329];

function linearRgbToGammaRgb(RGB: [number, number, number]) {
	// convert an array of linear-light sRGB values in the range 0.0-1.0
	// to gamma corrected form
	// https://en.wikipedia.org/wiki/SRGB
	// Extended transfer function:
	// For negative values, linear portion extends on reflection
	// of axis, then uses reflected pow below that
	return RGB.map((val) => {
		const sign = val < 0 ? -1 : 1;
		const abs = Math.abs(val);
		if (abs > 0.0031308) return sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
		return 12.92 * val;
	}) as [number, number, number];
}

function gammaRgbToLinearRgb(RGB: [number, number, number]) {
	// convert an array of sRGB values
	// where in-gamut values are in the range [0 - 1]
	// to linear light (un-companded) form.
	// en wiki: SRGB
	// Extended transfer function:
	// for negative values,  linear portion is extended on reflection of axis,
	// then reflected power function is used.
	return RGB.map(function (val) {
		const sign = val < 0 ? -1 : 1;
		const abs = Math.abs(val);
		if (abs < 0.04045) return val / 12.92;
		return sign * Math.pow((abs + 0.055) / 1.055, 2.4);
	}) as [number, number, number];
}

function linearRgbToXyz(rgb: [number, number, number]) {
	// convert an array of linear-light sRGB values to CIE XYZ
	// using sRGB's own white, D65 (no chromatic adaptation)
	const M = [
		[506752 / 1228815, 87881 / 245763, 12673 / 70218],
		[87098 / 409605, 175762 / 245763, 12673 / 175545],
		[7918 / 409605, 87881 / 737289, 1001167 / 1053270],
	];
	return multiplyMatrices(M, rgb) as [number, number, number];
}

function xyzToLinearRgb(XYZ: [number, number, number]) {
	// convert XYZ to linear-light sRGB
	const M = [
		[12831 / 3959, -329 / 214, -1974 / 3959],
		[-851781 / 878810, 1648619 / 878810, 36519 / 878810],
		[705 / 12673, -2585 / 12673, 705 / 667],
	];

	return multiplyMatrices(M, XYZ) as [number, number, number];
}

// OKLab and OKLCH
// https://bottosson.github.io/posts/oklab/

// XYZ <-> LMS matrices recalculated for consistent reference white
// see https://github.com/w3c/csswg-drafts/issues/6642#issuecomment-943521484

/** Convert xyz to oklab */
function xyzToLab(XYZ: [number, number, number]) {
	// Given XYZ relative to D65, convert to OKLab
	const XYZtoLMS = [
		[0.8190224432164319, 0.3619062562801221, -0.12887378261216414],
		[0.0329836671980271, 0.9292868468965546, 0.03614466816999844],
		[0.048177199566046255, 0.26423952494422764, 0.6335478258136937],
	];
	const LMStoOKLab = [
		[0.2104542553, 0.793617785, -0.0040720468],
		[1.9779984951, -2.428592205, 0.4505937099],
		[0.0259040371, 0.7827717662, -0.808675766],
	];

	const LMS = multiplyMatrices(XYZtoLMS, XYZ);
	return multiplyMatrices(
		LMStoOKLab,
		LMS.map((c) => Math.cbrt(c)),
	) as [number, number, number];
	// L in range [0,1]. For use in CSS, multiply by 100 and add a percent
}

/** Convert oklab to xyz */
function labToXyz(LAB: [number, number, number]) {
	// Given OKLab, convert to XYZ relative to D65
	const LMStoXYZ = [
		[1.2268798733741557, -0.5578149965554813, 0.28139105017721583],
		[-0.04057576262431372, 1.1122868293970594, -0.07171106666151701],
		[-0.07637294974672142, -0.4214933239627914, 1.5869240244272418],
	];
	const OKLabtoLMS = [
		// eslint-disable-next-line @typescript-eslint/no-loss-of-precision
		[0.99999999845051981432, 0.39633779217376785678, 0.21580375806075880339],
		// eslint-disable-next-line @typescript-eslint/no-loss-of-precision
		[1.0000000088817607767, -0.1055613423236563494, -0.063854174771705903402],
		// eslint-disable-next-line @typescript-eslint/no-loss-of-precision
		[1.0000000546724109177, -0.089484182094965759684, -1.2914855378640917399],
	];

	const LMSnl = multiplyMatrices(OKLabtoLMS, LAB);
	return multiplyMatrices(
		LMStoXYZ,
		LMSnl.map((c) => c ** 3),
	) as [number, number, number];
}

/** Convert oklch to oklab */
function labToLch(LAB: [number, number, number]) {
	const hue = (Math.atan2(LAB[2], LAB[1]) * 180) / Math.PI;
	return [
		LAB[0], // L is still L
		Math.sqrt(LAB[1] ** 2 + LAB[2] ** 2), // Chroma
		hue >= 0 ? hue : hue + 360, // Hue, in degrees [0 to 360)
	] as [number, number, number];
}

/** Convert oklch to oklab */
function lchToLab(LCH: [number, number, number]) {
	return [
		LCH[0], // L is still L
		LCH[1] * Math.cos((LCH[2] * Math.PI) / 180), // a
		LCH[1] * Math.sin((LCH[2] * Math.PI) / 180), // b
	] as [number, number, number];
}

/**
 * Simple matrix (and vector) multiplication
 * Warning: No error handling for incompatible dimensions!
 * @author Lea Verou 2020 MIT License
 */
// A is m x n. B is n x p. product is m x p.
function multiplyMatrices(A: any[][], B: any[]) {
	const m = A.length;

	if (!Array.isArray(A[0])) {
		// A is vector, convert to [[a, b, c, ...]]
		A = [A];
	}

	if (!Array.isArray(B[0])) {
		// B is vector, convert to [[a], [b], [c], ...]]
		B = B.map((x) => [x]);
	}

	const p = B[0].length;
	const B_cols = (B[0] as any[]).map((_, i) => B.map((x) => x[i])); // transpose B
	let product = A.map((row) =>
		B_cols.map((col) => {
			if (!Array.isArray(row)) {
				return col.reduce((a, c) => a + c * row, 0);
			}

			return row.reduce((a, c, i) => a + c * (col[i] || 0), 0);
		}),
	);

	if (m === 1) {
		product = product[0]; // Avoid [[a, b, c, ...]]
	}

	if (p === 1) {
		return product.map((x) => x[0]); // Avoid [[a], [b], [c], ...]]
	}

	return product;
}

//Rec. 2020-related functions

function D50_to_D65(XYZ: [number, number, number]) {
	// Bradford chromatic adaptation from D50 to D65
	const M = [
		[0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
		[-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
		[0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
	];

	return multiplyMatrices(M, XYZ) as [number, number, number];
}

function D65_to_D50(XYZ: [number, number, number]) {
	// Bradford chromatic adaptation from D65 to D50
	// The matrix below is the result of three operations:
	// - convert from XYZ to retinal cone domain
	// - scale components from one reference white to another
	// - convert back to XYZ
	// http://www.brucelindbloom.com/index.html?Eqn_ChromAdapt.html
	const M = [
		[1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
		[0.029627815688159344, 0.990434484573249, -0.01707382502938514],
		[-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
	];
	return multiplyMatrices(M, XYZ) as [number, number, number];
}
