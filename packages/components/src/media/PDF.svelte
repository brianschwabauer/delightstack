<script lang="ts" module>
	export interface PDFAnnotation {
		/** The kind of annotation */
		type: 'highlight' | 'note';
		/** The 1-based page number the annotation belongs to */
		page: number;
		/** Arbitrary annotation payload (position, text, etc.) */
		data: unknown;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { DelightError } from '@delightstack/utilities';
	import { scrollbar } from '../actions/scrollbar';

	const propId = $props.id();

	let {
		/** PDF source: URL string, ArrayBuffer, or Uint8Array */
		src,

		/** Current page number (1-based) */
		page = $bindable(1),

		/** Zoom level (1 = 100%) */
		zoom = $bindable(1),

		/** Rotation in degrees (0, 90, 180, 270) */
		rotation = 0,

		/** Initial fit mode */
		fit = 'width' as 'width' | 'height' | 'page',

		/** Show toolbar */
		show_toolbar = true,

		/** Show download button in toolbar */
		show_download = true,

		/** Enable text search */
		searchable = true,

		/** Enable annotations */
		annotatable = false,

		/** Container height */
		height = '600px',

		/**
		 * When true, only the current `page` is rendered (others hidden), the
		 * internal scroll container is disabled, and the page is centered to
		 * fill the container. The toolbar is typically also hidden via
		 * `show_toolbar={false}`. Used when an external orchestrator (e.g. the
		 * Carousel component) drives page navigation.
		 */
		single_page = false,

		/**
		 * In single_page mode, automatically translate the stacked page slots so
		 * the bound `page` is shown. Defaults to true for standalone use. The
		 * Carousel sets this false because it drives the slide translation itself.
		 */
		auto_paginate = true,

		/**
		 * Multiplier applied to the rendered canvas resolution without changing
		 * the displayed CSS size. Lets an external orchestrator (Carousel pinch
		 * zoom) push more pixels into the canvas so a magnified page stays
		 * crisp. Defaults to 1; bumping to 2 quadruples the rasterized pixel
		 * count of each rendered page.
		 */
		pixel_density = 1,

		/**
		 * Show a loading skeleton while the document loads (including before
		 * `src` is available). It dismisses itself as soon as the document is
		 * ready — set to `false` to disable the built-in loading state.
		 */
		skeleton = true,

		/**
		 * Render the selectable/searchable text layer over each page. Disable it
		 * (e.g. inside a Carousel) to skip `getTextContent()` and per-glyph span
		 * layout on every page — a meaningful render-perf win when text selection
		 * isn't needed. Search still works (it extracts text separately).
		 */
		text_layer = true,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

		/** Bindable element reference */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Fired when the current page changes */
		onpagechange = undefined as
			| ((detail: { page: number; total_pages: number }) => void)
			| undefined,

		/** Fired when the PDF finishes loading */
		onload = undefined as ((detail: { total_pages: number }) => void) | undefined,

		/** Fired when the PDF fails to load */
		onerror = undefined as ((detail: { error: Error }) => void) | undefined,

		/** Fired when download is clicked */
		ondownload = undefined as (() => void) | undefined,

		/** Fired when an annotation is created */
		onannotation = undefined as ((detail: PDFAnnotation) => void) | undefined,
	}: {
		src?: string | ArrayBuffer | Uint8Array;
		page?: number;
		zoom?: number;
		rotation?: number;
		fit?: 'width' | 'height' | 'page';
		show_toolbar?: boolean;
		show_download?: boolean;
		searchable?: boolean;
		annotatable?: boolean;
		height?: string;
		single_page?: boolean;
		auto_paginate?: boolean;
		pixel_density?: number;
		skeleton?: boolean;
		text_layer?: boolean;
		id?: string;
		class?: string;
		element?: HTMLElement | undefined;
		onpagechange?: (detail: { page: number; total_pages: number }) => void;
		onload?: (detail: { total_pages: number }) => void;
		onerror?: (detail: { error: Error }) => void;
		ondownload?: () => void;
		onannotation?: (detail: PDFAnnotation) => void;
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Types                                                              */
	/* ------------------------------------------------------------------ */

	interface PageInfo {
		width: number;
		height: number;
		rendered: boolean;
	}

	interface SearchMatch {
		page: number;
		index: number;
	}

	/* ------------------------------------------------------------------ */
	/*  State                                                              */
	/* ------------------------------------------------------------------ */

	let pdf_doc = $state<unknown>(undefined);
	let total_pages = $state(0);
	let loading = $state(true);
	let error_message = $state('');
	let page_infos = $state<PageInfo[]>([]);
	let page_elements = $state<(HTMLDivElement | null)[]>([]);
	let pages_container = $state<HTMLDivElement | null>(null);
	let page_input_value = $state('1');

	// Search state
	let search_open = $state(false);
	let search_query = $state('');
	let search_matches = $state<SearchMatch[]>([]);
	let search_current = $state(0);
	let page_texts = $state<string[]>([]);
	let search_input_el = $state<HTMLInputElement | null>(null);

	// Annotation state
	let annotation_mode = $state<'highlight' | 'note' | null>(null);

	// PDF.js library reference
	let pdfjs_lib: unknown = undefined;

	// Track which pages are rendered
	let rendered_pages = $state(new Set<number>());

	// Track in-flight render tasks per page so rapid page switches don't
	// fire concurrent renderPage() calls against the same canvas — that race
	// causes `canvas.width = ...` to clear pixels in the middle of an
	// already-running pdfjs render, making the page momentarily transparent.
	const rendering_pages = new Map<number, Promise<void>>();

	// Track the current fit mode for cycling — seeded once from the prop on
	// purpose; the fit-cycle control owns it afterwards.
	let current_fit = $state(untrack(() => fit));

	// Prevent scroll observer feedback loop
	let programmatic_scroll = false;

	/* ------------------------------------------------------------------ */
	/*  Derived                                                            */
	/* ------------------------------------------------------------------ */

	const zoom_percent = $derived(Math.round(zoom * 100));

	const search_count_text = $derived.by(() => {
		if (search_matches.length === 0) return search_query ? 'No matches' : '';
		return `${search_current + 1} of ${search_matches.length}`;
	});

	/* ------------------------------------------------------------------ */
	/*  PDF.js lazy loader                                                 */
	/* ------------------------------------------------------------------ */

	async function loadPdfJs(): Promise<unknown> {
		if (pdfjs_lib) return pdfjs_lib;
		// @ts-ignore — pdfjs-dist is an optional peer dependency
		const lib = await import('pdfjs-dist');
		const version = (lib as { version: string }).version;
		// pdfjs-dist >= 5 auto-initializes GlobalWorkerOptions.workerSrc to a
		// placeholder relative path ("./pdf.worker.mjs") at import time, which
		// 404s in any non-bundled context. Always set it to a known-good CDN URL
		// for our version. (Consumers who want a different worker can set it
		// themselves before mounting <PDF> — we only overwrite the placeholder.)
		const workerOptions = (lib as { GlobalWorkerOptions: { workerSrc: string } })
			.GlobalWorkerOptions;
		const cdnUrl = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
		const isPlaceholder =
			!workerOptions.workerSrc ||
			workerOptions.workerSrc === './pdf.worker.mjs' ||
			workerOptions.workerSrc === 'pdf.worker.mjs';
		if (workerOptions && isPlaceholder) {
			workerOptions.workerSrc = cdnUrl;
		}
		pdfjs_lib = lib;
		return lib;
	}

	/* ------------------------------------------------------------------ */
	/*  Document loading                                                   */
	/* ------------------------------------------------------------------ */

	async function loadDocument(source: string | ArrayBuffer | Uint8Array) {
		loading = true;
		error_message = '';
		pdf_doc = undefined;
		total_pages = 0;
		page_infos = [];
		page_texts = [];
		rendered_pages = new Set();

		try {
			const lib = (await loadPdfJs()) as Record<string, unknown>;
			const getDocument = lib.getDocument as (params: Record<string, unknown>) => {
				promise: Promise<unknown>;
			};

			const params: Record<string, unknown> = {};
			if (typeof source === 'string') {
				params.url = source;
			} else {
				params.data = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
			}

			const doc = await getDocument(params).promise;
			const typedDoc = doc as {
				numPages: number;
				getPage: (n: number) => Promise<unknown>;
			};
			pdf_doc = doc;
			total_pages = typedDoc.numPages;

			// Gather page dimensions
			const infos: PageInfo[] = [];
			for (let i = 1; i <= total_pages; i++) {
				const pg = await typedDoc.getPage(i);
				const typedPage = pg as {
					getViewport: (opts: { scale: number; rotation: number }) => {
						width: number;
						height: number;
					};
				};
				const vp = typedPage.getViewport({ scale: 1, rotation });
				infos.push({ width: vp.width, height: vp.height, rendered: false });
			}
			page_infos = infos;
			page_elements = Array.from({ length: total_pages }, () => null);

			loading = false;
			onload?.({ total_pages });

			// Extract text for search (skipped in single_page mode where there's no search UI)
			if (searchable && !single_page) {
				extractAllText(typedDoc);
			}
		} catch (err) {
			loading = false;
			const e = err instanceof Error ? err : new DelightError(String(err));
			error_message = e.message;
			onerror?.({ error: e });
		}
	}

	async function extractAllText(doc: {
		numPages: number;
		getPage: (n: number) => Promise<unknown>;
	}) {
		const texts: string[] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			try {
				const pg = await doc.getPage(i);
				const typedPage = pg as {
					getTextContent: () => Promise<{ items: { str?: string }[] }>;
				};
				const content = await typedPage.getTextContent();
				const text = content.items.map((item) => item.str || '').join(' ');
				texts.push(text);
			} catch {
				texts.push('');
			}
		}
		page_texts = texts;
	}

	/* ------------------------------------------------------------------ */
	/*  Page rendering                                                     */
	/* ------------------------------------------------------------------ */

	async function renderPage(page_num: number) {
		if (!pdf_doc || rendered_pages.has(page_num)) return;
		// If a render for this page is already in flight, let it finish —
		// reissuing now would clear the canvas mid-paint and race the first
		// render's `pdfjs.render(...).promise` against a fresh one.
		const inFlight = rendering_pages.get(page_num);
		if (inFlight) return inFlight;

		const task = renderPageImpl(page_num);
		rendering_pages.set(page_num, task);
		try {
			await task;
		} finally {
			rendering_pages.delete(page_num);
		}
	}

	async function renderPageImpl(page_num: number) {
		if (!pdf_doc) return;
		const typedDoc = pdf_doc as { getPage: (n: number) => Promise<unknown> };
		const pg = await typedDoc.getPage(page_num);
		const typedPage = pg as {
			getViewport: (opts: { scale: number; rotation: number }) => {
				width: number;
				height: number;
				transform: number[];
			};
			render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
				promise: Promise<void>;
			};
			getTextContent: () => Promise<{
				items: { str?: string; transform?: number[]; width?: number; height?: number }[];
			}>;
		};

		// Display viewport drives the CSS size; the render viewport multiplies
		// `pixel_density` so the canvas holds extra pixels for crisp display
		// when an external orchestrator scales the canvas up (e.g. pinch zoom).
		const display_viewport = typedPage.getViewport({ scale: zoom, rotation });
		const effective_density = Math.max(1, pixel_density || 1);
		const render_viewport =
			effective_density === 1
				? display_viewport
				: typedPage.getViewport({ scale: zoom * effective_density, rotation });
		const container_el = page_elements[page_num - 1];
		if (!container_el) return;

		// Render into an offscreen canvas so the currently-displayed canvas
		// (if any) keeps its pixels until the new draw is complete. Then swap
		// the offscreen into the DOM atomically. Without this, setting
		// `canvas.width` on an in-DOM canvas clears it to transparent and the
		// page background appears to "vanish" until pdfjs finishes painting.
		const next_canvas = document.createElement('canvas');
		next_canvas.classList.add('pdf-page-canvas');
		next_canvas.width = render_viewport.width;
		next_canvas.height = render_viewport.height;
		next_canvas.style.width = `${display_viewport.width}px`;
		next_canvas.style.height = `${display_viewport.height}px`;

		const ctx = next_canvas.getContext('2d');
		if (!ctx) return;

		try {
			await typedPage.render({ canvasContext: ctx, viewport: render_viewport }).promise;
		} catch {
			// render cancelled or failed, ignore
			return;
		}

		// Swap: remove the old canvas (if any), insert the freshly painted one.
		const old_canvas = container_el.querySelector('canvas');
		if (old_canvas) old_canvas.remove();
		container_el.insertBefore(next_canvas, container_el.firstChild);

		// Text layer (anchored to display size so its hit targets stay aligned
		// with the visible canvas, not the higher-resolution backing store).
		// Skipped entirely when `text_layer` is false (e.g. inside a Carousel) —
		// avoids getTextContent() + per-glyph span layout on every page.
		const existing_layer = container_el.querySelector(
			'.pdf-text-layer',
		) as HTMLDivElement | null;
		if (!text_layer) {
			if (existing_layer) existing_layer.remove();
		} else {
			const layer_el = existing_layer ?? document.createElement('div');
			if (!existing_layer) {
				layer_el.classList.add('pdf-text-layer');
				container_el.appendChild(layer_el);
			}
			layer_el.innerHTML = '';
			layer_el.style.width = `${display_viewport.width}px`;
			layer_el.style.height = `${display_viewport.height}px`;

			try {
				const content = await typedPage.getTextContent();
				for (const item of content.items) {
					if (!item.str) continue;
					const span = document.createElement('span');
					span.textContent = item.str;
					if (item.transform) {
						const tx = item.transform[4] * zoom;
						const ty = display_viewport.height - item.transform[5] * zoom;
						const font_size = Math.abs(item.transform[3]) * zoom;
						span.style.position = 'absolute';
						span.style.left = `${tx}px`;
						span.style.top = `${ty - font_size}px`;
						span.style.fontSize = `${font_size}px`;
						span.style.fontFamily = 'sans-serif';
						span.style.whiteSpace = 'pre';
					}
					layer_el.appendChild(span);
				}
			} catch {
				// text extraction failed, ignore
			}
		}

		// Update container size — skipped in single_page mode where the slot
		// is sized to fill the slide and the canvas is centered inside it.
		if (!single_page) {
			container_el.style.width = `${display_viewport.width}px`;
			container_el.style.height = `${display_viewport.height}px`;
		}

		rendered_pages = new Set([...rendered_pages, page_num]);
	}

	function clearRenderedPages() {
		rendered_pages = new Set();
		// Drop the in-flight render registrations too — any pending render
		// will still complete and swap its (possibly stale) canvas into the
		// DOM, but the next render call for that page will not be short-
		// circuited by a stale promise.
		rendering_pages.clear();
		// Note: deliberately DO NOT remove the existing <canvas> nodes here.
		// renderPage paints into an offscreen canvas and only swaps it into
		// the DOM once the new render is complete, so leaving the old one
		// in place prevents the page from going transparent during the
		// re-render (which is what happens when zoom or pixel_density
		// changes while the user is mid-interaction).
	}

	/* ------------------------------------------------------------------ */
	/*  Virtualized rendering with IntersectionObserver                    */
	/* ------------------------------------------------------------------ */

	function setupObserver() {
		if (!pages_container || typeof IntersectionObserver === 'undefined') return;
		// In single_page mode the consumer drives the page index externally,
		// so we skip the observer (it would fight the external `page` prop).
		if (single_page) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const el = entry.target as HTMLDivElement;
					const page_num = parseInt(el.dataset.page || '0', 10);
					if (!page_num) continue;

					if (entry.isIntersecting) {
						renderPage(page_num);

						// Also render neighbors
						if (page_num > 1) renderPage(page_num - 1);
						if (page_num < total_pages) renderPage(page_num + 1);

						// Update current page from scroll
						if (!programmatic_scroll) {
							if (entry.intersectionRatio > 0.3 || entry.isIntersecting) {
								const new_page = page_num;
								if (new_page !== page) {
									page = new_page;
									page_input_value = String(new_page);
									onpagechange?.({ page: new_page, total_pages });
								}
							}
						}
					}
				}
			},
			{
				root: pages_container,
				rootMargin: '200px 0px',
				threshold: [0, 0.3, 0.5, 1],
			},
		);

		for (const el of page_elements) {
			if (el) observer.observe(el);
		}

		return () => observer.disconnect();
	}

	/* ------------------------------------------------------------------ */
	/*  Navigation                                                         */
	/* ------------------------------------------------------------------ */

	function goToPage(target: number) {
		const clamped = Math.max(1, Math.min(target, total_pages));
		page = clamped;
		page_input_value = String(clamped);
		onpagechange?.({ page: clamped, total_pages });
		scrollToPage(clamped);
	}

	function scrollToPage(page_num: number) {
		const el = page_elements[page_num - 1];
		if (!el || !pages_container) return;
		programmatic_scroll = true;
		// Scroll the pages container directly. Compute the offset using
		// bounding rects so it works regardless of which ancestor is the
		// element's offsetParent — `el.scrollIntoView` walks all scrollable
		// ancestors (including the window), which can result in the outer page
		// scrolling instead of the PDF viewer when both are scrollable.
		const elRect = el.getBoundingClientRect();
		const containerRect = pages_container.getBoundingClientRect();
		const target = pages_container.scrollTop + (elRect.top - containerRect.top);
		pages_container.scrollTo({ top: target, behavior: 'smooth' });
		setTimeout(() => {
			programmatic_scroll = false;
		}, 500);
	}

	function handlePageInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const val = parseInt(input.value, 10);
		if (!isNaN(val) && val >= 1 && val <= total_pages) {
			goToPage(val);
		}
	}

	function handlePageInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			handlePageInput(e);
			(e.target as HTMLInputElement).blur();
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Zoom                                                               */
	/* ------------------------------------------------------------------ */

	function setZoom(new_zoom: number) {
		const clamped = Math.max(0.25, Math.min(4, new_zoom));
		// Tolerate floating-point drift so applyFit() — which is called on
		// every page change — doesn't wipe the rendered canvases when the
		// computed fit zoom is "the same" but differs by a hair.
		if (Math.abs(clamped - zoom) < 0.001) return;
		zoom = clamped;
		clearRenderedPages();
		requestAnimationFrame(() => {
			renderVisiblePages();
		});
	}

	function zoomIn() {
		const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
		const next = steps.find((s) => s > zoom);
		setZoom(next ?? 4);
	}

	function zoomOut() {
		const steps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
		const prev = [...steps].reverse().find((s) => s < zoom);
		setZoom(prev ?? 0.25);
	}

	function resetZoom() {
		setZoom(1);
	}

	/* ------------------------------------------------------------------ */
	/*  Fit mode                                                           */
	/* ------------------------------------------------------------------ */

	function cycleFit() {
		const modes: ('width' | 'height' | 'page')[] = ['width', 'page'];
		const idx = modes.indexOf(current_fit);
		current_fit = modes[(idx + 1) % modes.length];
		applyFit();
	}

	function applyFit() {
		if (!pages_container || page_infos.length === 0) return;
		const container_rect = pages_container.getBoundingClientRect();
		// In single_page mode the active page may be a different size than page 1.
		const ref_page = single_page
			? page_infos[Math.max(0, Math.min(page_infos.length - 1, page - 1))]
			: page_infos[0];
		if (!ref_page) return;

		// In single_page mode the parent (e.g. Carousel) handles its own framing;
		// don't reserve internal padding.
		const padding = single_page ? 0 : 32;
		const available_width = container_rect.width - padding;
		const available_height = container_rect.height - padding;

		if (current_fit === 'width') {
			setZoom(available_width / ref_page.width);
		} else if (current_fit === 'height') {
			setZoom(available_height / ref_page.height);
		} else {
			// 'page' - fit the whole page
			const scale_w = available_width / ref_page.width;
			const scale_h = available_height / ref_page.height;
			setZoom(Math.min(scale_w, scale_h));
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Render visible pages helper                                        */
	/* ------------------------------------------------------------------ */

	function renderVisiblePages() {
		if (!pages_container) return;
		// In single_page mode, render the active page plus its immediate
		// neighbors so that a vertical swipe in the parent Carousel can
		// reveal the next/prev page mid-gesture without a flash of empty
		// space. Distant pages stay unrendered to keep memory in check.
		if (single_page) {
			renderPage(page);
			if (page > 1) renderPage(page - 1);
			if (page < total_pages) renderPage(page + 1);
			return;
		}
		const rect = pages_container.getBoundingClientRect();
		for (let i = 0; i < page_elements.length; i++) {
			const el = page_elements[i];
			if (!el) continue;
			const er = el.getBoundingClientRect();
			if (er.bottom >= rect.top - 200 && er.top <= rect.bottom + 200) {
				renderPage(i + 1);
			}
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Search                                                             */
	/* ------------------------------------------------------------------ */

	function openSearch() {
		if (!searchable) return;
		search_open = true;
		requestAnimationFrame(() => {
			search_input_el?.focus();
		});
	}

	function closeSearch() {
		search_open = false;
		search_query = '';
		search_matches = [];
		search_current = 0;
	}

	function performSearch(query: string) {
		if (!query.trim()) {
			search_matches = [];
			search_current = 0;
			return;
		}

		const lower_query = query.toLowerCase();
		const matches: SearchMatch[] = [];

		for (let i = 0; i < page_texts.length; i++) {
			const text = page_texts[i].toLowerCase();
			let start = 0;
			let idx = text.indexOf(lower_query, start);
			while (idx !== -1) {
				matches.push({ page: i + 1, index: idx });
				start = idx + 1;
				idx = text.indexOf(lower_query, start);
			}
		}

		search_matches = matches;
		search_current = matches.length > 0 ? 0 : 0;

		if (matches.length > 0) {
			goToPage(matches[0].page);
		}
	}

	function searchNext() {
		if (search_matches.length === 0) return;
		search_current = (search_current + 1) % search_matches.length;
		goToPage(search_matches[search_current].page);
	}

	function searchPrev() {
		if (search_matches.length === 0) return;
		search_current = (search_current - 1 + search_matches.length) % search_matches.length;
		goToPage(search_matches[search_current].page);
	}

	function handleSearchInput(e: Event) {
		search_query = (e.target as HTMLInputElement).value;
		performSearch(search_query);
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			if (e.shiftKey) {
				searchPrev();
			} else {
				searchNext();
			}
		} else if (e.key === 'Escape') {
			closeSearch();
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Download                                                           */
	/* ------------------------------------------------------------------ */

	function handleDownload() {
		ondownload?.();

		if (src == null) return;
		if (typeof src === 'string') {
			const a = document.createElement('a');
			a.href = src;
			a.download = src.split('/').pop() || 'document.pdf';
			a.click();
		} else {
			// Copy into a fresh Uint8Array so the BlobPart is backed by a plain
			// ArrayBuffer (a SharedArrayBuffer-backed view isn't a valid BlobPart)
			const bytes = src instanceof Uint8Array ? new Uint8Array(src) : src;
			const blob = new Blob([bytes], { type: 'application/pdf' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'document.pdf';
			a.click();
			URL.revokeObjectURL(url);
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Annotations                                                        */
	/* ------------------------------------------------------------------ */

	function handlePageMouseUp(page_num: number) {
		if (!annotatable) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return;

		if (annotation_mode === 'highlight') {
			const text = selection.toString();
			if (text) {
				onannotation?.({ type: 'highlight', page: page_num, data: { text } });
			}
		}
	}

	function handlePageClick(e: MouseEvent, page_num: number) {
		if (!annotatable || annotation_mode !== 'note') return;
		const target = e.currentTarget as HTMLDivElement;
		const rect = target.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		onannotation?.({ type: 'note', page: page_num, data: { x, y } });
	}

	/* ------------------------------------------------------------------ */
	/*  Keyboard shortcuts                                                 */
	/* ------------------------------------------------------------------ */

	function handleKeydown(e: KeyboardEvent) {
		const is_mac =
			typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
		const mod = is_mac ? e.metaKey : e.ctrlKey;

		if (mod && e.key === 'f' && searchable) {
			e.preventDefault();
			openSearch();
			return;
		}

		if (e.key === 'Escape' && search_open) {
			closeSearch();
			return;
		}

		if (mod && (e.key === '=' || e.key === '+')) {
			e.preventDefault();
			zoomIn();
			return;
		}

		if (mod && e.key === '-') {
			e.preventDefault();
			zoomOut();
			return;
		}

		if (mod && e.key === '0') {
			e.preventDefault();
			resetZoom();
			return;
		}

		// Don't handle navigation keys when input is focused
		if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

		switch (e.key) {
			case 'ArrowLeft':
			case 'PageUp':
				e.preventDefault();
				goToPage(page - 1);
				break;
			case 'ArrowRight':
			case 'PageDown':
				e.preventDefault();
				goToPage(page + 1);
				break;
			case 'Home':
				e.preventDefault();
				goToPage(1);
				break;
			case 'End':
				e.preventDefault();
				goToPage(total_pages);
				break;
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Placeholder dimensions for unrendered pages                        */
	/* ------------------------------------------------------------------ */

	function getPageStyle(index: number): string {
		const info = page_infos[index];
		if (!info) return '';
		const w = info.width * zoom;
		const h = info.height * zoom;
		return `width: ${w}px; height: ${h}px;`;
	}

	/* ------------------------------------------------------------------ */
	/*  Effects                                                            */
	/* ------------------------------------------------------------------ */

	// Load document when src changes
	$effect(() => {
		void src;
		if (typeof window === 'undefined') return;
		if (src == null) {
			// No document yet (e.g. progressively assigned) — stay in the
			// loading state so the skeleton shows instead of an error.
			loading = true;
			return;
		}
		loadDocument(src);
	});

	// Setup intersection observer after pages mount
	$effect(() => {
		if (total_pages > 0 && pages_container && page_elements.length > 0) {
			// Wait for elements to be in DOM
			const timer = setTimeout(() => {
				const cleanup = setupObserver();
				applyFit();
				return cleanup;
			}, 50);
			return () => clearTimeout(timer);
		}
	});

	// Re-render when zoom/rotation/pixel_density changes — wrap body in
	// untrack so `clearRenderedPages` (which iterates `page_elements`
	// reactively) doesn't pull every page_elements mutation into this
	// effect's dependency set.
	$effect(() => {
		void zoom;
		void rotation;
		void pixel_density;
		untrack(() => {
			if (total_pages > 0) {
				clearRenderedPages();
				requestAnimationFrame(() => renderVisiblePages());
			}
		});
	});

	// Sync page input value when page prop changes externally
	$effect(() => {
		page_input_value = String(page);
	});

	// React to external page changes — fire ONLY when `page` itself changes.
	// applyFit/scrollToPage transitively read other reactive state (page_infos,
	// page_elements, etc.) which mutate during rendering, so wrap the body in
	// untrack() to keep this effect from running on every mutation.
	$effect(() => {
		void page;
		untrack(() => {
			if (total_pages > 0 && page >= 1 && page <= total_pages) {
				if (single_page) {
					// In single_page mode the active + adjacent pages are all
					// rendered into the same DOM, stacked vertically. Switching
					// to a neighboring page just needs to render any NEW
					// neighbor that isn't already drawn — don't `clearRenderedPages`
					// or the current page's canvas vanishes for a frame, leaving
					// the slot transparent until pdfjs finishes the re-render.
					// applyFit can change `zoom` if pages differ in size; the
					// zoom effect handles a full re-render in that case.
					const prevZoom = zoom;
					applyFit();
					if (prevZoom === zoom) {
						requestAnimationFrame(() => renderVisiblePages());
					}
				} else {
					scrollToPage(page);
				}
			}
		});
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	{id}
	class={['pdf-container', class_name].filter(Boolean).join(' ')}
	class:single-page={single_page}
	class:auto-paginate={single_page && auto_paginate}
	style:--pdf-height={height}
	bind:this={element}
	onkeydown={handleKeydown}
	tabindex="0"
	role="document"
	aria-label="PDF viewer">
	{#if skeleton && loading && !single_page}
		<!-- Skeleton / Loading (suppressed in single_page mode — used inside
		     the Carousel, which prefers a blank slide over a placeholder UI
		     while the document is being fetched). -->
		<div class="skeleton">
			{#if show_toolbar}
				<div class="bar">
					<div class="block" style="width: 6rem; height: 1.5rem;"></div>
					<div class="block" style="width: 4rem; height: 1.5rem;"></div>
				</div>
			{/if}
			<div class="page">
				<div class="paper">
					{#each { length: 13 } as _, i}
						<div
							class="line"
							style:width="{45 + ((i * 37) % 50)}%"
							style:--shimmer-delay="{i * 90}ms">
						</div>
					{/each}
				</div>
			</div>
		</div>
	{:else if error_message}
		<!-- Error state -->
		<div class="error">
			<svg
				width="48"
				height="48"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
			<span>Failed to load PDF</span>
			<span class="detail">{error_message}</span>
		</div>
	{:else}
		<!-- Toolbar -->
		{#if show_toolbar}
			<div class="toolbar">
				<!-- Page navigation -->
				<div class="group">
					<button
						type="button"
						class="btn"
						onclick={() => goToPage(page - 1)}
						disabled={page <= 1}
						aria-label="Previous page">
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true">
							<path
								d="M10 3L5 8L10 13"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round" />
						</svg>
					</button>

					<input
						type="text"
						value={page_input_value}
						oninput={(e) => {
							page_input_value = (e.target as HTMLInputElement).value;
						}}
						onblur={handlePageInput}
						onkeydown={handlePageInputKeydown}
						aria-label="Page number" />
					<span class="total">/ {total_pages}</span>

					<button
						type="button"
						class="btn"
						onclick={() => goToPage(page + 1)}
						disabled={page >= total_pages}
						aria-label="Next page">
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true">
							<path
								d="M6 3L11 8L6 13"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round" />
						</svg>
					</button>
				</div>

				<div class="separator"></div>

				<!-- Zoom controls -->
				<div class="group">
					<button
						type="button"
						class="btn"
						onclick={zoomOut}
						disabled={zoom <= 0.25}
						aria-label="Zoom out">
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true">
							<path
								d="M3 8H13"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round" />
						</svg>
					</button>

					<span class="zoom">{zoom_percent}%</span>

					<button
						type="button"
						class="btn"
						onclick={zoomIn}
						disabled={zoom >= 4}
						aria-label="Zoom in">
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true">
							<path
								d="M8 3V13M3 8H13"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round" />
						</svg>
					</button>
				</div>

				<div class="separator"></div>

				<!-- Fit mode -->
				<div class="group">
					<button
						type="button"
						class="btn"
						onclick={cycleFit}
						aria-label="Toggle fit mode ({current_fit})"
						title="Fit: {current_fit}">
						{#if current_fit === 'width'}
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								aria-hidden="true">
								<path
									d="M2 4V12M14 4V12M4 8H12M4 6L2 8L4 10M12 6L14 8L12 10"
									stroke="currentColor"
									stroke-width="1.25"
									stroke-linecap="round"
									stroke-linejoin="round" />
							</svg>
						{:else}
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								aria-hidden="true">
								<rect
									x="3"
									y="2"
									width="10"
									height="12"
									rx="1"
									stroke="currentColor"
									stroke-width="1.25" />
							</svg>
						{/if}
					</button>
				</div>

				<div class="spacer"></div>

				<!-- Search button -->
				{#if searchable}
					<button
						type="button"
						class="btn"
						class:active={search_open}
						onclick={() => (search_open ? closeSearch() : openSearch())}
						aria-label="Search">
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true">
							<circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.5" />
							<path
								d="M10 10L13 13"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round" />
						</svg>
					</button>
				{/if}

				<!-- Download button -->
				{#if show_download}
					<button
						type="button"
						class="btn"
						onclick={handleDownload}
						aria-label="Download">
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true">
							<path
								d="M8 2V10M8 10L5 7M8 10L11 7"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round" />
							<path
								d="M3 13H13"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round" />
						</svg>
					</button>
				{/if}

				<!-- Annotation toggle -->
				{#if annotatable}
					<div class="separator"></div>
					<div class="group">
						<button
							type="button"
							class="btn"
							class:active={annotation_mode === 'highlight'}
							onclick={() =>
								(annotation_mode = annotation_mode === 'highlight' ? null : 'highlight')}
							aria-label="Highlight mode"
							title="Highlight text">
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								aria-hidden="true">
								<rect
									x="2"
									y="10"
									width="12"
									height="3"
									rx="0.5"
									fill="currentColor"
									opacity="0.3" />
								<path
									d="M3 7H13"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round" />
							</svg>
						</button>
						<button
							type="button"
							class="btn"
							class:active={annotation_mode === 'note'}
							onclick={() =>
								(annotation_mode = annotation_mode === 'note' ? null : 'note')}
							aria-label="Note mode"
							title="Add note">
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								aria-hidden="true">
								<rect
									x="2"
									y="2"
									width="12"
									height="12"
									rx="2"
									stroke="currentColor"
									stroke-width="1.25" />
								<path
									d="M5 5H11M5 8H9"
									stroke="currentColor"
									stroke-width="1.25"
									stroke-linecap="round" />
							</svg>
						</button>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Search bar -->
		{#if search_open}
			<div class="search-bar">
				<input
					type="text"
					placeholder="Search in document..."
					value={search_query}
					bind:this={search_input_el}
					oninput={handleSearchInput}
					onkeydown={handleSearchKeydown}
					aria-label="Search text" />
				{#if search_count_text}
					<span class="count">{search_count_text}</span>
				{/if}
				<button
					type="button"
					class="btn"
					onclick={searchPrev}
					disabled={search_matches.length === 0}
					aria-label="Previous match">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M12 10L8 6L4 10"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
				</button>
				<button
					type="button"
					class="btn"
					onclick={searchNext}
					disabled={search_matches.length === 0}
					aria-label="Next match">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M4 6L8 10L12 6"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
				</button>
				<button type="button" class="btn" onclick={closeSearch} aria-label="Close search">
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M4 4L12 12M12 4L4 12"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round" />
					</svg>
				</button>
			</div>
		{/if}

		<!-- Pages -->
		<div
			class="pdf-pages"
			bind:this={pages_container}
			style={single_page && auto_paginate
				? `transform: translateY(-${(page - 1) * 100}%); transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);`
				: undefined}
			{@attach scrollbar()}>
			{#each page_infos as info, i}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="pdf-page"
					class:single-page-slot={single_page}
					data-page={i + 1}
					style={single_page ? `top: ${i * 100}%;` : getPageStyle(i)}
					bind:this={page_elements[i]}
					onmouseup={() => handlePageMouseUp(i + 1)}
					onclick={(e) => handlePageClick(e, i + 1)}>
					{#if !rendered_pages.has(i + 1) && !single_page}
						<div class="placeholder">
							<span>{i + 1}</span>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* ── Container ────────────────────────────────────────────── */

	.pdf-container {
		position: relative;
		width: 100%;
		height: var(--pdf-height, 600px);
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md, 0.5rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 0.5rem) * var(--squircle-ratio, 2));
		}
		overflow: hidden;
		background: light-dark(
			var(--color-bg-muted, #f1f5f9),
			var(--color-bg-muted, #0f172a)
		);
		outline: none;
	}

	.pdf-container:focus-visible {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: -2px;
	}

	/* ── Toolbar ──────────────────────────────────────────────── */

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: light-dark(var(--color-surface, #f8fafc), var(--color-surface, #1a2332));
		border-bottom: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		flex-shrink: 0;
		flex-wrap: wrap;

		.group {
			display: flex;
			align-items: center;
			gap: 0.25rem;
		}

		.separator {
			width: 1px;
			height: 1.5rem;
			background: var(--color-border, light-dark(#e2e8f0, #334155));
			margin-inline: 0.25rem;
		}

		.spacer {
			flex: 1;
		}

		input {
			width: 3rem;
			text-align: center;
			padding: 0.25rem;
			border: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
			border-radius: var(--radius-sm, 0.25rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-sm, 0.25rem) * var(--squircle-ratio, 2));
			}
			font-size: var(--text-sm, 0.875rem);
			background: light-dark(var(--color-bg, #ffffff), var(--color-bg, #1e293b));
			color: var(--color-text, light-dark(#1e293b, #e2e8f0));

			&:focus {
				outline: 2px solid var(--color-action, #3b82f6);
				outline-offset: -1px;
			}
		}

		.total {
			font-size: var(--text-sm, 0.875rem);
			color: var(--color-text-muted, light-dark(#64748b, #94a3b8));
			user-select: none;
		}

		.zoom {
			font-size: var(--text-sm, 0.875rem);
			color: var(--color-text, light-dark(#1e293b, #e2e8f0));
			min-width: 3rem;
			text-align: center;
			user-select: none;
			font-variant-numeric: tabular-nums;
		}
	}

	/* Shared by the toolbar and the search bar */
	.btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		background: none;
		border-radius: var(--radius-sm, 0.25rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-sm, 0.25rem) * var(--squircle-ratio, 2));
		}
		cursor: pointer;
		color: var(--color-text, light-dark(#1e293b, #e2e8f0));
		transition: background 150ms ease;

		&:hover {
			background: light-dark(
				var(--color-surface, rgb(0 0 0 / 0.06)),
				var(--color-surface, rgb(255 255 255 / 0.08))
			);
			/* Snap the tint in on hover; the base rule eases it back out on leave. */
			transition: none;
		}

		&:disabled {
			opacity: 0.4;
			cursor: default;

			&:hover {
				background: none;
			}
		}

		&.active {
			background: light-dark(
				rgb(from var(--color-action, #3b82f6) r g b / 0.12),
				rgb(from var(--color-action, #3b82f6) r g b / 0.2)
			);
			color: var(--color-action, #3b82f6);
		}
	}

	/* ── Search bar ───────────────────────────────────────────── */

	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: light-dark(var(--color-surface, #f8fafc), var(--color-surface, #1a2332));
		border-bottom: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		flex-shrink: 0;

		input {
			flex: 1;
			min-width: 0;
			padding: 0.25rem 0.5rem;
			border: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
			border-radius: var(--radius-sm, 0.25rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-sm, 0.25rem) * var(--squircle-ratio, 2));
			}
			font-size: var(--text-sm, 0.875rem);
			background: light-dark(var(--color-bg, #ffffff), var(--color-bg, #1e293b));
			color: var(--color-text, light-dark(#1e293b, #e2e8f0));

			&:focus {
				outline: 2px solid var(--color-action, #3b82f6);
				outline-offset: -1px;
			}
		}

		.count {
			font-size: var(--text-xs, 0.75rem);
			color: var(--color-text-muted, light-dark(#64748b, #94a3b8));
			white-space: nowrap;
			user-select: none;
		}
	}

	/* ── Pages container ──────────────────────────────────────── */

	.pdf-pages {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.single-page {
		height: 100%;
		background: transparent;
		border-radius: 0;
		/* Allow adjacent pages to render outside the slide bounds so the
		   Carousel can scroll between them with both pages visible at once. */
		overflow: visible;
	}
	/* When the PDF paginates itself (standalone single-page mode) clip to the
	   container so only the active page shows during the translate. */
	.single-page.auto-paginate {
		overflow: hidden;
	}

	.single-page .pdf-pages {
		/* The slide is one page tall; adjacent pages live at top: ±100%
		   relative to this container and need to be visible during swipe
		   transitions. */
		overflow: visible;
		padding: 0;
		gap: 0;
		display: block;
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
	}

	.pdf-page.single-page-slot {
		/* Each page slot is absolutely positioned in a vertical stack so a
		   carousel `translateY(-page * 100%)` on the parent reveals the
		   prev/next page during the swipe. The slot fills the slide; the
		   actual page canvas is centered inside via flex.

		   `transform-origin: 0 0` is required so the per-slot matrices applied
		   by the Carousel (which already bake the origin into the matrix via
		   the translate-scale-translate trick) anchor zooms at the click
		   location rather than the slot's geometric center. */
		position: absolute;
		left: 0;
		right: 0;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		box-shadow: none;
		transform-origin: 0 0;
		will-change: transform;
	}

	.pdf-page.single-page-slot :global(canvas) {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		box-shadow:
			0 1px 3px rgb(0 0 0 / 0.12),
			0 1px 2px rgb(0 0 0 / 0.08);
	}

	/* ── Page ─────────────────────────────────────────────────── */

	.pdf-page {
		position: relative;
		box-shadow:
			0 1px 3px rgb(0 0 0 / 0.12),
			0 1px 2px rgb(0 0 0 / 0.08);
		background: white;
		flex-shrink: 0;
	}

	.pdf-page :global(canvas) {
		display: block;
	}

	.pdf-page :global(.pdf-text-layer) {
		position: absolute;
		inset: 0;
		overflow: hidden;
		opacity: 0.25;
		line-height: 1;
	}

	.pdf-page :global(.pdf-text-layer span) {
		color: transparent;
	}

	.pdf-page :global(.pdf-text-layer span::selection) {
		background: color-mix(in oklch, var(--color-action, #3b82f6) 40%, transparent);
	}

	.pdf-page .placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: white;

		span {
			font-size: 2rem;
			color: light-dark(#cbd5e1, #475569);
			user-select: none;
		}
	}

	/* ── Error state ──────────────────────────────────────────── */

	.error {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		color: var(--color-text-muted, light-dark(#64748b, #94a3b8));
		padding: 2rem;
		text-align: center;

		.detail {
			font-size: var(--text-sm, 0.875rem);
			max-width: 30rem;
			word-break: break-word;
		}
	}

	/* ── Skeleton ─────────────────────────────────────────────── */

	.skeleton {
		flex: 1;
		display: flex;
		flex-direction: column;
		pointer-events: none;

		.bar {
			display: flex;
			align-items: center;
			gap: 1rem;
			padding: 0.5rem 0.75rem;
			border-bottom: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		}

		.block {
			border-radius: var(--radius-sm, 0.25rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-sm, 0.25rem) * var(--squircle-ratio, 2));
			}
			background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));
			position: relative;
			overflow: hidden;

			&::after {
				content: '';
				position: absolute;
				inset: 0;
				transform: translateX(-100%);
				background-image: linear-gradient(
					105deg,
					transparent 25%,
					var(--skeleton-sheen, rgb(from var(--color-text, #888) r g b / 0.12)) 50%,
					transparent 75%
				);
				animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
					infinite;
			}
		}

		/* Centering backdrop behind the "paper". A subtle surface tint makes the
		   white page read as a sheet of paper regardless of the page theme. */
		/* Full-width backdrop behind the "paper". A subtle surface tint makes the
		   white page read as a sheet of paper regardless of the page theme. Grid
		   centering (rather than flex) lets the paper derive its width from its
		   definite height + aspect-ratio instead of collapsing to its content. */
		.page {
			flex: 1;
			min-height: 0;
			display: grid;
			place-items: center;
			padding: 1.5rem;
			background: light-dark(#f1f5f9, #0f172a);
		}

		/* The page itself — a portrait US-letter sheet (8.5 × 11) in white, since
		   most PDFs are white paper. Lines below mimic dark text. */
		.paper {
			height: 100%;
			aspect-ratio: 8.5 / 11;
			max-width: 100%;
			background: #ffffff;
			border-radius: 3px;
			box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
			display: flex;
			flex-direction: column;
			gap: 0.85rem;
			padding: 9% 10%;
			overflow: hidden;
		}

		.line {
			flex: none;
			height: 0.7rem;
			border-radius: 3px;
			background: rgba(15, 23, 42, 0.08);
			position: relative;
			overflow: hidden;

			&::after {
				content: '';
				position: absolute;
				inset: 0;
				transform: translateX(-100%);
				/* The paper is always white, so the sheen stays ink-on-paper rather
				   than using the theme-aware skeleton tokens. */
				background-image: linear-gradient(
					105deg,
					rgba(15, 23, 42, 0) 25%,
					rgba(15, 23, 42, 0.14) 50%,
					rgba(15, 23, 42, 0) 75%
				);
				animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
					infinite;
				animation-delay: var(--shimmer-delay, 0ms);
			}
		}
	}

	@keyframes -global-delight-skeleton-shimmer {
		0% {
			transform: translateX(-100%);
		}
		55%,
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton .block::after,
		.skeleton .line::after {
			animation: none;
		}
	}
</style>
