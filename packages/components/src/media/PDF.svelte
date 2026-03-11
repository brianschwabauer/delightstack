<script lang="ts" module>
	import { createEventDispatcher, untrack } from 'svelte';
	import type { PDFPageProxy, PDFDocumentProxy } from 'pdfjs-dist';
	import type {
		DocumentInitParameters,
		RenderParameters,
		RenderTask,
	} from 'pdfjs-dist/types/src/display/api.js';
	import { isEqual } from '@packages/api';
	import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

	// let pdfWorker: PDFWorker | undefined;
	const lastRenderTask = new WeakMap<HTMLCanvasElement, RenderTask>();

	/** Loads the PDF at the given URL and returns the parsed document */
	export async function loadPdf(src: string, options?: DocumentInitParameters) {
		if (import.meta.env.SSR) return;
		const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
		GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
		const doc = getDocument({
			url: src,
			isOffscreenCanvasSupported: true,
			maxImageSize: 4096 * 4096,
			...options,
		});
		return doc.promise.catch((err) => {
			try {
				doc?.destroy();
			} catch (error) {}
			console.error(err);
			return undefined;
		});
	}

	/** Renders the given pdf page to the given canvas element. (Fits the pdf into the canvas size) */
	export async function renderPdfPage(
		page: PDFPageProxy,
		canvas: HTMLCanvasElement,
		options?: RenderParameters,
	) {
		if (import.meta.env.SSR) return;
		if (!page || !canvas) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		let viewport = page.getViewport({ scale: 1 });
		const pdfW = viewport.width || 1;
		const pdfH = viewport.height || 1;
		const targetW = canvas.width || 1;
		const targetH = canvas.height || 1;
		if (pdfW !== targetW || pdfH !== targetH) {
			const pdfRatio = pdfW / pdfH;
			const targetRatio = targetW / targetH;
			const scale = pdfRatio >= targetRatio ? targetW / pdfW : targetH / pdfH;
			const offsetX = (targetW - pdfW * scale) / 2;
			const offsetY = (targetH - pdfH * scale) / 2;
			context.fillStyle = 'white';
			context.fillRect(offsetX, offsetY, pdfW * scale, pdfH * scale);
			viewport = page.getViewport({ scale, offsetX, offsetY });
		}
		if (lastRenderTask.has(canvas)) lastRenderTask.get(canvas)?.cancel();
		const renderTask = page.render({
			canvasContext: context,
			viewport,
			background: 'transparent',
			canvas: canvas || null,
			...options,
		});
		lastRenderTask.set(canvas, renderTask);
		return renderTask.promise.catch(() => ({}));
	}
</script>

<script lang="ts">
	type $$Events = {
		/** Emits when the pdf has been loaded */
		load: CustomEvent<{ numPages: number }>;
	};

	let {
		/** The current page to display (starts at 0 index). If maxPages is more than one, this will be the offset */
		page = 0,

		/** The total amount of pages to show at once */
		maxPages = Infinity,

		/** The URL to the pdf to show */
		src = '',

		/** Whether the pdf should not be re-rendered when pageBounds changes. This becomes true when the parent component is animating & wants to limit main thread usage */
		disableRender = false,

		/** The size (width/height) that each page should be rendered at */
		pageBounds = [] as { width: number; height: number }[],

		/** The css style string added to the component from the parent */
		style = '',

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** A callback function that is called when the pdf loads. Returns the number of pages in the pdf */
		onload = undefined as ((e: { numPages: number }) => void) | undefined,
	} = $props();

	/** The default resolution of the page (in px) */
	const DEFAULT_PAGE_SIZE = 1024;

	const dispatch = createEventDispatcher();

	let _pageBounds = pageBounds;
	let _src: typeof src | undefined;
	let pdf = $state.raw<PDFDocumentProxy | undefined>();
	let pages = $state.raw<(PDFPageProxy | undefined)[]>([]);
	let canvases = $state<HTMLCanvasElement[]>([]);
	let loaded = $state(false);
	let resizeTimer: ReturnType<typeof setTimeout> | undefined;
	const lastPage = $derived(Math.min(page + maxPages, pdf?.numPages || 0));

	$effect(() => {
		if (src && !isEqual(src, _src)) {
			loaded = false;
			_src = src;
			untrack(() => {
				loadPdf(src).then((v) => (pdf = v));
			});
		}
	});
	$effect(() => {
		if (!src) pdf = undefined;
	});
	$effect(() => {
		if (pdf) {
			const from = page;
			const to = lastPage;
			untrack(() => loadPages(from, to));
		}
	});
	$effect(() => {
		if (
			loaded &&
			pageBounds?.length &&
			!isEqual(pageBounds, _pageBounds) &&
			!disableRender
		) {
			untrack(() => {
				clearTimeout(resizeTimer);
				_pageBounds = pageBounds;
				resizeTimer = setTimeout(() => renderPagesOnResize(), 200);
			});
		}
	});

	/** Loads the pages between the two given indexes and renders the pages to the right canvases */
	async function loadPages(from: number, to: number) {
		for (let i = from; i < to; i++) {
			const pageData = await pdf?.getPage(i + 1);
			pages[i] = pageData;
			const canvas = canvases[i - from];
			const { width, height } = getPageBounds(i);
			if (canvas && pageData) {
				canvas.width = width;
				canvas.height = height;
				await renderPdfPage(pageData, canvas);
				if (!loaded) {
					_pageBounds = pageBounds;
					loaded = true;
					dispatch('load', { numPages: pdf?.numPages || 1 });
					onload?.({ numPages: pdf?.numPages || 1 });
				}
			}
		}
	}

	/** Re-render the pdf when the requested resolution changes */
	let pendingRenderJob: Promise<void> = Promise.resolve();
	let resizeJobTime = 0;
	const prevPageBounds = new Map<number, { width: number; height: number }>();
	async function renderPagesOnResize() {
		const startTime = Date.now();
		resizeJobTime = startTime;
		async function run() {
			for (let i = page; i < lastPage; i++) {
				if (resizeJobTime !== startTime) return;
				const { width, height } = getPageBounds(i);
				const prevWidth = prevPageBounds.get(i)?.width;
				const prevHeight = prevPageBounds.get(i)?.height;
				prevPageBounds.set(i, { width, height });
				const canvas = canvases[i - page];
				if (!canvas) continue;
				const context = canvas.getContext('2d');
				if (!canvas || !width || !height || !pages[i] || !context) continue;
				if (canvas.width === width && canvas.height === height) continue;
				if (prevWidth && prevHeight) {
					let tempCanvas = document.createElement('canvas');
					tempCanvas.width = prevWidth;
					tempCanvas.height = prevHeight;
					let tempContext = tempCanvas.getContext('2d');
					if (tempContext) tempContext.drawImage(canvas, 0, 0);
					canvas.width = width;
					canvas.height = height;
					context.drawImage(tempCanvas, 0, 0, prevWidth, prevHeight, 0, 0, width, height);
					tempCanvas.width = width;
					tempCanvas.height = height;
					await renderPdfPage(pages[i]!, tempCanvas);
					context.clearRect(0, 0, width, height);
					context.drawImage(tempCanvas, 0, 0);
					tempCanvas = null as any;
					tempContext = null;
				} else {
					canvas.width = width;
					canvas.height = height;
					await renderPdfPage(pages[i]!, canvas);
				}
			}
		}
		await pendingRenderJob;
		pendingRenderJob = run();
	}

	/** Returns the proper width & height that the page at the given index should be rendered at */
	function getPageBounds(index: number) {
		const bounds = pageBounds[index];
		let width = bounds?.width || pageBounds[0]?.width || DEFAULT_PAGE_SIZE;
		let height = bounds?.height || pageBounds[0]?.height || DEFAULT_PAGE_SIZE;
		const maxSize = navigator.vendor.match(/apple/i) ? 4096 : 8192;
		if (width > maxSize || height > maxSize) {
			if (width > height) {
				height = Math.floor((height / width) * maxSize);
				width = maxSize;
			} else {
				width = Math.floor((width / height) * maxSize);
				height = maxSize;
			}
		}
		return { width, height };
	}
</script>

{#each Array(Math.max(1, lastPage - page)) as _, i}
	<canvas bind:this={canvases[i]} class={className} {style}></canvas>
{/each}

<style lang="scss">
	canvas {
		border: none;
		outline: none;
		overflow: hidden;
	}
</style>
