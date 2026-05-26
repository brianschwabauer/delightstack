import { thumbHashToDataURL } from 'thumbhash';

// const BACK_OUT_EASTING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const BACK_OUT_EASTING = 'cubic-bezier(0.34, 1.30, 0.55, 1)';
const DELTA_LINE_MULTIPLIER = 8;
const DELTA_PAGE_MULTIPLIER = 24;
const MAX_WHEEL_DELTA = 24;

export interface Point {
	x: number;
	y: number;
}
export interface Pointer {
	id: string;
	x: number;
	y: number;
	dx: number;
	dy: number;
	dt: number;
	vx: number;
	vy: number;
	primary: boolean;
	time: number;
}
export interface Transform {
	scale: number;
	rotation: number;
	translateX: number;
	translateY: number;
	originX: number;
	originY: number;
}

/** The options used to fit an element inside the bounds */
export interface FitParams {
	/** The scale of the element @default 1 */
	scale?: number;

	/** The width of the viewport/container in pixels */
	viewportW?: number;

	/** The height of the viewport/container in pixels */
	viewportH?: number;

	/** The amount of pixels around the element to pad the bounds by */
	padding?: number;

	/** The aspect ratio of the image */
	ratio?: number;
}

export interface ElementAnimationOptions {
	transform?: string | DOMMatrix;
	opacity?: number;
	duration?: number;
	easing?: 'back-out' | string;
	id?: string; // the ID of the animation used for cancelling & retrieving
}

/** The kind of media displayed by the carousel */
export type CarouselItemType = 'image' | 'video' | 'pdf' | 'embed';

/**
 * A media item that can be rendered by the carousel.
 * Strings are also accepted as a shorthand for an image URL.
 */
export interface CarouselItem {
	/** A stable identifier for the item. If omitted, the src is used. */
	id?: string;

	/** The kind of media. @default 'image' */
	type?: CarouselItemType;

	/**
	 * The source for the media. For images, accepts either a single URL or
	 * a srcset string with width descriptors:
	 *   src: "https://.../photo.jpg"
	 *   src: "https://.../sm 400w, https://.../lg 1600w"
	 * For videos / pdfs / embeds, always a single URL.
	 */
	src: string;

	/** The intrinsic width of the image in pixels (used for aspect ratio before load) */
	width?: number;

	/** The intrinsic height of the image in pixels (used for aspect ratio before load) */
	height?: number;

	/** Short display label (e.g. file name). Used as the default alt text. */
	name?: string;

	/** Longer descriptive caption — shown in the carousel modal (preferred over name). */
	caption?: string;

	/** Explicit alt text override. If omitted, falls back to {@link name}. */
	alt?: string;

	/**
	 * A base64-encoded [ThumbHash](https://evanw.github.io/thumbhash/) used as
	 * a tiny blurred placeholder while the full image loads. The component
	 * decodes this internally.
	 */
	thumbhash?: string;

	/** Whether an image should be rendered as a 360° panorama */
	panorama?: boolean;

	/**
	 * Mark this item as above-the-fold for faster initial paint. When true,
	 * the image uses `loading="eager"` + `fetchpriority="high"` so the browser
	 * prioritises it. Defaults to lazy loading.
	 */
	priority?: boolean;
}

/**
 * The gesture performed by the user on the gallery
 * - 'pinch-zoom' - the user is panning/zooming the image with two fingers (or panning with one finger while zoomed in)
 * - 'pan-x' - the user is panning the image horizontally to potentially change the image
 * - 'pan-y-dismiss' - the user is panning the image vertically to close the gallery
 * - 'pan-y-page' - the user is panning the pdf vertically to change to a different page
 * - 'indeterminate' - the action (touch down) has started but we don't know what it is yet
 * - 'none' - the user is not interacting
 */
export type GalleryGesture =
	| 'pinch-zoom'
	| 'pan-x'
	| 'pan-y-dismiss'
	| 'pan-y-page'
	| 'pinch'
	| 'indeterminate'
	| 'none';

/** Returns the centroid center point between all the given points */
export function center(...points: Point[]) {
	const x = points.reduce((a, b) => a + b.x, 0) / points.length;
	const y = points.reduce((a, b) => a + b.y, 0) / points.length;
	return { x, y };
}

/** Returns the distance between two points. Always a positive number */
export function distance(pointA: Point, pointB: Point) {
	if (!pointA || !pointB) return 0;
	return Math.sqrt((pointA.x - pointB.x) ** 2 + (pointA.y - pointB.y) ** 2);
}

/** Calculates the angle between two points (in radians) */
export function angle(pointA: Point, pointB: Point) {
	if (!pointA || !pointB) return 0;
	return (180 / Math.PI) * Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x);
}

/** Creates a new DOMMatrix based on the transform string. If force3d, it will ensure the matrix is 3d */
export function createMatrix(transform?: string | DOMMatrix, force3d = true) {
	const Matrix = (window as any).WebKitCSSMatrix || window.DOMMatrix;
	if (transform instanceof Matrix) return Matrix.fromMatrix(transform);
	if (!force3d) return new Matrix(transform || '');
	if (transform) {
		const matrix = new Matrix(transform);
		if (!matrix.is2D) return matrix;
		return new Matrix(Array.from(matrix.toFloat32Array()));
	}
	return new Matrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** Extracts the x, y, and scale of the given matrix */
export function extractMatrixTransform(matrix: DOMMatrix) {
	const scale = Math.hypot(matrix.a, matrix.b);
	return { scale, x: matrix.e / scale, y: matrix.f / scale };
}

/** Animates the target element to the given transform matrix. Returns a promise that resolves when complete */
export async function animateElement(
	element?: HTMLElement,
	options?: KeyframeAnimationOptions & ElementAnimationOptions,
): Promise<void> {
	if (!element) return;
	element.getAnimations().forEach((animation) => {
		try {
			animation.commitStyles();
		} catch {
			// ignore
		}
	});
	const matrix = options?.transform || createMatrix();
	const animation = element.animate(
		[
			{
				transform: typeof matrix === 'string' ? matrix : matrix.toString(),
				...(options?.opacity !== undefined && { opacity: `${options.opacity}` }),
			},
		],
		{
			direction: 'normal',
			fill: 'both',
			...options,
			duration: options?.duration || 250,
			easing:
				options?.easing === 'back-out' ? BACK_OUT_EASTING : options?.easing || 'ease-out',
		},
	);
	await animation.finished.catch(() => {});
	try {
		animation.commitStyles();
		animation.finish();
		animation.cancel();
	} catch {
		return;
	}
}

/** Calculates the transform of the pointers based on their relationship to each other */
export function calcTransform(
	pointer: Pointer,
	pointers: { [id: string]: Pointer },
	midpoint: Point,
	prevPointers: { [id: string]: Pointer },
	prevMidpoint?: Point,
): Transform {
	const prevPointer = prevPointers[pointer.id];
	if (!prevPointer) {
		return {
			scale: 1,
			rotation: 0,
			translateX: 0,
			translateY: 0,
			originX: 0,
			originY: 0,
		};
	}
	const prevPointerList = Object.values(prevPointers);
	const pointerList = Object.values(pointers);
	const primary =
		pointerList.find((p) => p.primary) ||
		[...pointerList].sort((a, b) => a.time - b.time)[0];
	const prevPrimary =
		prevPointerList.find((p) => p.id === primary.id) ||
		prevPointerList.find((p) => p.primary) ||
		[...prevPointerList].sort((a, b) => a.time - b.time)[0] ||
		primary;
	let scale = 1;
	let rotation = 0;
	if (pointerList.length > 1) {
		const scaleList = pointerList
			.filter((p) => p.id !== primary.id)
			.map((p) => {
				if (!prevPointers[p.id]) return 1;
				const prevDistance = distance(prevPointers[p.id], prevPrimary);
				if (!prevDistance) return 1;
				return distance(p, primary) / prevDistance;
			});
		scale = scaleList.reduce((a, b) => a + b, 0) / (scaleList.length || 1) || 1;
		const rotationList = pointerList.map((p) =>
			!prevPointers[p.id]
				? 1
				: angle(p, primary) - angle(prevPointers[p.id], prevPrimary),
		);
		rotation = rotationList.reduce((a, b) => a + b, 0) / rotationList.length;
	}
	return {
		scale,
		rotation,
		translateX:
			pointerList.length > 1 && prevMidpoint
				? (midpoint?.x || 0) - (prevMidpoint?.x || 0)
				: prevPointer
					? pointer.x - prevPointer.x
					: 0,
		translateY:
			pointerList.length > 1 && prevMidpoint
				? (midpoint?.y || 0) - (prevMidpoint?.y || 0)
				: prevPointer
					? pointer.y - prevPointer.y
					: 0,
		originX: prevMidpoint?.x || 0,
		originY: prevMidpoint?.y || 0,
	};
}

/** Returns the min/max of the x/y position that should be used to ensure the element fits in the bounds */
export function calcBounds(options: FitParams) {
	const scale = options?.scale || 1;
	const viewportW = options?.viewportW || window.innerWidth;
	const viewportH = options?.viewportH || window.innerHeight;
	if (scale <= 1) {
		const x = (viewportW * (1 - scale)) / 2;
		const y = (viewportH * (1 - scale)) / 2;
		return { minX: x, maxX: x, minY: y, maxY: y };
	}
	const padding = (options?.padding || 0) / scale;
	const ratio = options?.ratio || 1;
	const viewportRatio = viewportW / (viewportH || 1);
	const imageW = ratio >= viewportRatio ? viewportW : viewportH * ratio;
	const imageH = ratio >= viewportRatio ? viewportW / ratio : viewportH;
	const containerW = viewportW;
	const containerH = viewportH;
	const containerPaddingW = (containerW * scale - imageW * scale) / 2;
	const containerPaddingH = (containerH * scale - imageH * scale) / 2;
	const imagePaddingW = Math.abs(imageW * scale - viewportW);
	const imagePaddingH = Math.abs(imageH * scale - viewportH);
	let minX = (-containerPaddingW - imagePaddingW) / scale - padding;
	let maxX = (imageW - containerW) / 2 + padding;
	let minY = (-containerPaddingH - imagePaddingH) / scale - padding;
	let maxY = (imageH - containerH) / 2 + padding;
	if (imageW * scale < viewportW - padding * 2) {
		minX = (viewportW - containerW * scale) / 2 / scale;
		maxX = minX;
	}
	if (imageH * scale < viewportH - padding * 2) {
		minY = (viewportH - containerH * scale) / 2 / scale;
		maxY = minY;
	}
	return { minX, maxX, minY, maxY };
}

/** Calculates the transform matrix that would ensure the image stays in the bounds of the window */
export function clampMatrix(matrix: DOMMatrix, options: FitParams) {
	const { scale, x, y } = extractMatrixTransform(matrix);
	const viewportW = options?.viewportW || window.innerWidth;
	const viewportH = options?.viewportH || window.innerHeight;
	if (scale <= 1) {
		return createMatrix()
			.translate((viewportW * (1 - scale)) / 2, (viewportH * (1 - scale)) / 2)
			.scale(scale);
	}
	const { minX, minY, maxX, maxY } = calcBounds({ ...options, scale });
	const targetX = Math.max(minX, Math.min(maxX, x));
	const targetY = Math.max(minY, Math.min(maxY, y));
	return matrix.translate(targetX - x, targetY - y);
}

/** Returns the deltaX/deltaY of the given wheel event - normalized between devices */
export function normalizeWheel(e: WheelEvent) {
	function limit(delta: number, max_delta: number) {
		return Math.sign(delta) * Math.min(max_delta, Math.abs(delta));
	}
	let dx = e.deltaX;
	let dy = e.deltaY;
	if (e.shiftKey && dx === 0) {
		[dx, dy] = [dy, dx];
	}
	if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
		dx *= DELTA_LINE_MULTIPLIER;
		dy *= DELTA_LINE_MULTIPLIER;
	} else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		dx *= DELTA_PAGE_MULTIPLIER;
		dy *= DELTA_PAGE_MULTIPLIER;
	}
	return [limit(dx, MAX_WHEEL_DELTA), limit(dy, MAX_WHEEL_DELTA)];
}

/** Returns whether the given item can be swiped left/right */
export function isSwipeable(item: CarouselItem | undefined | null) {
	return !!item && item.type !== 'embed' && !item.panorama;
}

/** Returns whether the given item can be pinched/zoomed */
export function isScalable(item: CarouselItem | undefined | null) {
	return (
		!!item && item.type !== 'embed' && item.type !== 'video' && item.panorama !== true
	);
}

/**
 * Normalizes any acceptable carousel input (string src, partial item, or a full item)
 * into a guaranteed CarouselItem. Returns `undefined` for inputs that can't be coerced.
 */
export function normalizeCarouselItem(
	input: string | Partial<CarouselItem> | undefined | null,
): CarouselItem | undefined {
	if (!input) return undefined;
	if (typeof input === 'string') {
		return { src: input, type: 'image' };
	}
	if (!input.src) return undefined;
	return {
		type: input.type || 'image',
		...input,
	} as CarouselItem;
}

/**
 * Returns the highest-width URL from a srcset-style string, or the URL as-is if it's
 * already a single URL. Used to extract a single `src` for elements that don't accept
 * srcset (video, iframe, pdf consumers, download links).
 */
export function pickLargestSrc(src: string | undefined): string {
	if (!src) return '';
	if (!src.includes(',') && !src.includes(' ')) return src;
	let bestUrl = '';
	let bestWidth = -1;
	for (const entry of src.split(',')) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const parts = trimmed.split(/\s+/);
		const url = parts[0];
		if (!url) continue;
		const widthMatch = parts[1]?.match(/^(\d+)w$/);
		const width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
		if (width > bestWidth) {
			bestWidth = width;
			bestUrl = url;
		}
	}
	return bestUrl || src;
}

/** Module-level cache of "best resolution already loaded" per item id, so cross-mount renders */
/** of the same image avoid downgrading to a smaller resolution. */
const loadedResolutions = new Map<string, Set<number>>();

export function getLoadedResolutions(id: string): number[] {
	return Array.from(loadedResolutions.get(id) || []);
}

export function addLoadedResolution(id: string, resolution: number) {
	if (!id || !resolution || !Number.isFinite(resolution)) return;
	const set = loadedResolutions.get(id) || new Set<number>();
	set.add(resolution);
	loadedResolutions.set(id, set);
}

/** Memoized base64-thumbhash → data:image/png URL conversions. */
const thumbhashDecodeCache = new Map<string, string>();

/**
 * Decode a base64-encoded ThumbHash into a `data:image/png` URL suitable for
 * use as an `<img src>` value. Decoded URLs are memoized so repeated renders
 * of the same item don't pay the decode cost more than once.
 */
export function decodeThumbHash(base64: string): string {
	const cached = thumbhashDecodeCache.get(base64);
	if (cached) return cached;
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const url = thumbHashToDataURL(bytes);
	thumbhashDecodeCache.set(base64, url);
	return url;
}
