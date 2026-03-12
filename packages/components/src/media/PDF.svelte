<script lang="ts" module>
	export interface PDFAnnotation {
		type: 'highlight' | 'note';
		page: number;
		data: unknown;
	}
</script>

<script lang="ts">
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
		showToolbar = true,

		/** Show download button in toolbar */
		showDownload = true,

		/** Enable text search */
		searchable = true,

		/** Enable annotations */
		annotatable = false,

		/** Container height */
		height = '600px',

		/** Show loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Bindable element reference */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Fired when the current page changes */
		onpagechange = undefined as ((detail: { page: number; total_pages: number }) => void) | undefined,

		/** Fired when the PDF finishes loading */
		onload = undefined as ((detail: { total_pages: number }) => void) | undefined,

		/** Fired when the PDF fails to load */
		onerror = undefined as ((detail: { error: Error }) => void) | undefined,

		/** Fired when download is clicked */
		ondownload = undefined as (() => void) | undefined,

		/** Fired when an annotation is created */
		onannotation = undefined as ((detail: PDFAnnotation) => void) | undefined,
	}: {
		src: string | ArrayBuffer | Uint8Array;
		page?: number;
		zoom?: number;
		rotation?: number;
		fit?: 'width' | 'height' | 'page';
		showToolbar?: boolean;
		showDownload?: boolean;
		searchable?: boolean;
		annotatable?: boolean;
		height?: string;
		skeleton?: boolean;
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

	// Track the current fit mode for cycling
	let current_fit = $state(fit);

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
		(lib as Record<string, unknown>).GlobalWorkerOptions = (lib as Record<string, unknown>).GlobalWorkerOptions || {};
		((lib as Record<string, Record<string, unknown>>).GlobalWorkerOptions).workerSrc =
			`https://unpkg.com/pdfjs-dist@${(lib as Record<string, string>).version}/build/pdf.worker.min.mjs`;
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
			const lib = await loadPdfJs() as Record<string, unknown>;
			const getDocument = lib.getDocument as (params: Record<string, unknown>) => { promise: Promise<unknown> };

			const params: Record<string, unknown> = {};
			if (typeof source === 'string') {
				params.url = source;
			} else {
				params.data = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
			}

			const doc = await getDocument(params).promise;
			const typedDoc = doc as { numPages: number; getPage: (n: number) => Promise<unknown> };
			pdf_doc = doc;
			total_pages = typedDoc.numPages;

			// Gather page dimensions
			const infos: PageInfo[] = [];
			for (let i = 1; i <= total_pages; i++) {
				const pg = await typedDoc.getPage(i);
				const typedPage = pg as { getViewport: (opts: { scale: number; rotation: number }) => { width: number; height: number } };
				const vp = typedPage.getViewport({ scale: 1, rotation });
				infos.push({ width: vp.width, height: vp.height, rendered: false });
			}
			page_infos = infos;
			page_elements = new Array(total_pages).fill(null);

			loading = false;
			onload?.({ total_pages });

			// Extract text for search
			if (searchable) {
				extractAllText(typedDoc);
			}
		} catch (err) {
			loading = false;
			const e = err instanceof Error ? err : new Error(String(err));
			error_message = e.message;
			onerror?.({ error: e });
		}
	}

	async function extractAllText(doc: { numPages: number; getPage: (n: number) => Promise<unknown> }) {
		const texts: string[] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			try {
				const pg = await doc.getPage(i);
				const typedPage = pg as { getTextContent: () => Promise<{ items: { str?: string }[] }> };
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

		const typedDoc = pdf_doc as { getPage: (n: number) => Promise<unknown> };
		const pg = await typedDoc.getPage(page_num);
		const typedPage = pg as {
			getViewport: (opts: { scale: number; rotation: number }) => { width: number; height: number; transform: number[] };
			render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
			getTextContent: () => Promise<{ items: { str?: string; transform?: number[]; width?: number; height?: number }[] }>;
		};

		const viewport = typedPage.getViewport({ scale: zoom, rotation });
		const container_el = page_elements[page_num - 1];
		if (!container_el) return;

		// Canvas
		let canvas = container_el.querySelector('canvas');
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.classList.add('pdf-page-canvas');
			container_el.insertBefore(canvas, container_el.firstChild);
		}
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		canvas.style.width = `${viewport.width}px`;
		canvas.style.height = `${viewport.height}px`;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		try {
			await typedPage.render({ canvasContext: ctx, viewport }).promise;
		} catch {
			// render cancelled or failed, ignore
			return;
		}

		// Text layer
		let text_layer = container_el.querySelector('.pdf-text-layer') as HTMLDivElement | null;
		if (!text_layer) {
			text_layer = document.createElement('div');
			text_layer.classList.add('pdf-text-layer');
			container_el.appendChild(text_layer);
		}
		text_layer.innerHTML = '';
		text_layer.style.width = `${viewport.width}px`;
		text_layer.style.height = `${viewport.height}px`;

		try {
			const content = await typedPage.getTextContent();
			for (const item of content.items) {
				if (!item.str) continue;
				const span = document.createElement('span');
				span.textContent = item.str;
				if (item.transform) {
					const tx = item.transform[4] * zoom;
					const ty = viewport.height - item.transform[5] * zoom;
					const font_size = Math.abs(item.transform[3]) * zoom;
					span.style.position = 'absolute';
					span.style.left = `${tx}px`;
					span.style.top = `${ty - font_size}px`;
					span.style.fontSize = `${font_size}px`;
					span.style.fontFamily = 'sans-serif';
					span.style.whiteSpace = 'pre';
				}
				text_layer.appendChild(span);
			}
		} catch {
			// text extraction failed, ignore
		}

		// Update container size
		container_el.style.width = `${viewport.width}px`;
		container_el.style.height = `${viewport.height}px`;

		rendered_pages = new Set([...rendered_pages, page_num]);
	}

	function clearRenderedPages() {
		rendered_pages = new Set();
		for (const el of page_elements) {
			if (!el) continue;
			const canvas = el.querySelector('canvas');
			if (canvas) canvas.remove();
			const text_layer = el.querySelector('.pdf-text-layer');
			if (text_layer) text_layer.remove();
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Virtualized rendering with IntersectionObserver                    */
	/* ------------------------------------------------------------------ */

	function setupObserver() {
		if (!pages_container || typeof IntersectionObserver === 'undefined') return;

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
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
		zoom = Math.max(0.25, Math.min(4, new_zoom));
		clearRenderedPages();
		// Re-render visible pages after re-layout
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
		const first_page = page_infos[0];
		if (!first_page) return;

		const padding = 32; // 1rem on each side
		const available_width = container_rect.width - padding;
		const available_height = container_rect.height - padding;

		if (current_fit === 'width') {
			setZoom(available_width / first_page.width);
		} else if (current_fit === 'height') {
			setZoom(available_height / first_page.height);
		} else {
			// 'page' - fit the whole page
			const scale_w = available_width / first_page.width;
			const scale_h = available_height / first_page.height;
			setZoom(Math.min(scale_w, scale_h));
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Render visible pages helper                                        */
	/* ------------------------------------------------------------------ */

	function renderVisiblePages() {
		if (!pages_container) return;
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

		if (typeof src === 'string') {
			const a = document.createElement('a');
			a.href = src;
			a.download = src.split('/').pop() || 'document.pdf';
			a.click();
		} else {
			const blob = new Blob([src], { type: 'application/pdf' });
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
		const is_mac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');
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

	// Re-render when zoom/rotation changes
	$effect(() => {
		void zoom;
		void rotation;
		if (total_pages > 0) {
			clearRenderedPages();
			requestAnimationFrame(() => renderVisiblePages());
		}
	});

	// Sync page input value when page prop changes externally
	$effect(() => {
		page_input_value = String(page);
	});

	// Scroll to page when page changes externally
	$effect(() => {
		void page;
		if (total_pages > 0 && page >= 1 && page <= total_pages) {
			scrollToPage(page);
		}
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<div
	{id}
	class={['pdf-container', className].filter(Boolean).join(' ')}
	style:--pdf-height={height}
	bind:this={element}
	onkeydown={handleKeydown}
	tabindex="0"
	role="document"
	aria-label="PDF viewer"
>
	{#if skeleton || loading}
		<!-- Skeleton / Loading -->
		<div class="pdf-skeleton">
			<div class="pdf-skeleton-toolbar">
				<div class="pdf-skeleton-block" style="width: 6rem; height: 1.5rem;"></div>
				<div class="pdf-skeleton-block" style="width: 4rem; height: 1.5rem;"></div>
			</div>
			<div class="pdf-skeleton-page">
				{#each { length: 8 } as _, i}
					<div
						class="pdf-skeleton-line"
						style:width="{40 + ((i * 31) % 55)}%"
						style:animation-delay="{i * 100}ms"
					></div>
				{/each}
			</div>
		</div>
	{:else if error_message}
		<!-- Error state -->
		<div class="pdf-error">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
			<span>Failed to load PDF</span>
			<span class="pdf-error-detail">{error_message}</span>
		</div>
	{:else}
		<!-- Toolbar -->
		{#if showToolbar}
			<div class="pdf-toolbar">
				<!-- Page navigation -->
				<div class="pdf-toolbar-group">
					<button
						type="button"
						class="pdf-toolbar-btn"
						onclick={() => goToPage(page - 1)}
						disabled={page <= 1}
						aria-label="Previous page"
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>

					<input
						type="text"
						class="pdf-page-input"
						value={page_input_value}
						oninput={(e) => { page_input_value = (e.target as HTMLInputElement).value; }}
						onblur={handlePageInput}
						onkeydown={handlePageInputKeydown}
						aria-label="Page number"
					/>
					<span class="pdf-page-total">/ {total_pages}</span>

					<button
						type="button"
						class="pdf-toolbar-btn"
						onclick={() => goToPage(page + 1)}
						disabled={page >= total_pages}
						aria-label="Next page"
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>
				</div>

				<div class="pdf-toolbar-separator"></div>

				<!-- Zoom controls -->
				<div class="pdf-toolbar-group">
					<button
						type="button"
						class="pdf-toolbar-btn"
						onclick={zoomOut}
						disabled={zoom <= 0.25}
						aria-label="Zoom out"
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
						</svg>
					</button>

					<span class="pdf-zoom-level">{zoom_percent}%</span>

					<button
						type="button"
						class="pdf-toolbar-btn"
						onclick={zoomIn}
						disabled={zoom >= 4}
						aria-label="Zoom in"
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
						</svg>
					</button>
				</div>

				<div class="pdf-toolbar-separator"></div>

				<!-- Fit mode -->
				<div class="pdf-toolbar-group">
					<button
						type="button"
						class="pdf-toolbar-btn"
						onclick={cycleFit}
						aria-label="Toggle fit mode ({current_fit})"
						title="Fit: {current_fit}"
					>
						{#if current_fit === 'width'}
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<path d="M2 4V12M14 4V12M4 8H12M4 6L2 8L4 10M12 6L14 8L12 10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						{:else}
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<rect x="3" y="2" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.25" />
							</svg>
						{/if}
					</button>
				</div>

				<div class="pdf-toolbar-spacer"></div>

				<!-- Search button -->
				{#if searchable}
					<button
						type="button"
						class="pdf-toolbar-btn"
						class:active={search_open}
						onclick={() => search_open ? closeSearch() : openSearch()}
						aria-label="Search"
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.5" />
							<path d="M10 10L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
						</svg>
					</button>
				{/if}

				<!-- Download button -->
				{#if showDownload}
					<button
						type="button"
						class="pdf-toolbar-btn"
						onclick={handleDownload}
						aria-label="Download"
					>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
							<path d="M3 13H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
						</svg>
					</button>
				{/if}

				<!-- Annotation toggle -->
				{#if annotatable}
					<div class="pdf-toolbar-separator"></div>
					<div class="pdf-toolbar-group">
						<button
							type="button"
							class="pdf-toolbar-btn"
							class:active={annotation_mode === 'highlight'}
							onclick={() => annotation_mode = annotation_mode === 'highlight' ? null : 'highlight'}
							aria-label="Highlight mode"
							title="Highlight text"
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<rect x="2" y="10" width="12" height="3" rx="0.5" fill="currentColor" opacity="0.3" />
								<path d="M3 7H13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
							</svg>
						</button>
						<button
							type="button"
							class="pdf-toolbar-btn"
							class:active={annotation_mode === 'note'}
							onclick={() => annotation_mode = annotation_mode === 'note' ? null : 'note'}
							aria-label="Note mode"
							title="Add note"
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.25" />
								<path d="M5 5H11M5 8H9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
							</svg>
						</button>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Search bar -->
		{#if search_open}
			<div class="pdf-search-bar">
				<input
					type="text"
					class="pdf-search-input"
					placeholder="Search in document..."
					value={search_query}
					bind:this={search_input_el}
					oninput={handleSearchInput}
					onkeydown={handleSearchKeydown}
					aria-label="Search text"
				/>
				{#if search_count_text}
					<span class="pdf-search-count">{search_count_text}</span>
				{/if}
				<button
					type="button"
					class="pdf-toolbar-btn"
					onclick={searchPrev}
					disabled={search_matches.length === 0}
					aria-label="Previous match"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path d="M12 10L8 6L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
				<button
					type="button"
					class="pdf-toolbar-btn"
					onclick={searchNext}
					disabled={search_matches.length === 0}
					aria-label="Next match"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
				<button
					type="button"
					class="pdf-toolbar-btn"
					onclick={closeSearch}
					aria-label="Close search"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
					</svg>
				</button>
			</div>
		{/if}

		<!-- Pages -->
		<div class="pdf-pages" bind:this={pages_container}>
			{#each page_infos as info, i}
				<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
				<div
					class="pdf-page"
					data-page={i + 1}
					style={getPageStyle(i)}
					bind:this={page_elements[i]}
					onmouseup={() => handlePageMouseUp(i + 1)}
					onclick={(e) => handlePageClick(e, i + 1)}
				>
					{#if !rendered_pages.has(i + 1)}
						<div class="pdf-page-placeholder">
							<span class="pdf-page-placeholder-text">{i + 1}</span>
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
		overflow: hidden;
		background: light-dark(var(--color-surface-sunken, #f1f5f9), var(--color-surface-sunken, #0f172a));
		outline: none;
	}

	.pdf-container:focus-visible {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: -2px;
	}

	/* ── Toolbar ──────────────────────────────────────────────── */

	.pdf-toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: light-dark(var(--color-surface, #ffffff), var(--color-surface, #1e293b));
		border-bottom: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.pdf-toolbar-group {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.pdf-toolbar-separator {
		width: 1px;
		height: 1.5rem;
		background: var(--color-border, light-dark(#e2e8f0, #334155));
		margin-inline: 0.25rem;
	}

	.pdf-toolbar-spacer {
		flex: 1;
	}

	.pdf-toolbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		background: none;
		border-radius: var(--radius-sm, 0.25rem);
		cursor: pointer;
		color: var(--color-text, light-dark(#1e293b, #e2e8f0));
		transition: background 150ms ease;
	}

	.pdf-toolbar-btn:hover {
		background: light-dark(
			var(--color-surface-raised, rgb(0 0 0 / 0.06)),
			var(--color-surface-raised, rgb(255 255 255 / 0.08))
		);
	}

	.pdf-toolbar-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.pdf-toolbar-btn:disabled:hover {
		background: none;
	}

	.pdf-toolbar-btn.active {
		background: light-dark(
			rgb(from var(--color-action, #3b82f6) r g b / 0.12),
			rgb(from var(--color-action, #3b82f6) r g b / 0.2)
		);
		color: var(--color-action, #3b82f6);
	}

	.pdf-page-input {
		width: 3rem;
		text-align: center;
		padding: 0.25rem;
		border: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		border-radius: var(--radius-sm, 0.25rem);
		font-size: var(--text-sm, 0.875rem);
		background: light-dark(var(--color-surface, #ffffff), var(--color-surface, #1e293b));
		color: var(--color-text, light-dark(#1e293b, #e2e8f0));
	}

	.pdf-page-input:focus {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: -1px;
	}

	.pdf-page-total {
		font-size: var(--text-sm, 0.875rem);
		color: var(--color-text-muted, light-dark(#64748b, #94a3b8));
		user-select: none;
	}

	.pdf-zoom-level {
		font-size: var(--text-sm, 0.875rem);
		color: var(--color-text, light-dark(#1e293b, #e2e8f0));
		min-width: 3rem;
		text-align: center;
		user-select: none;
		font-variant-numeric: tabular-nums;
	}

	/* ── Search bar ───────────────────────────────────────────── */

	.pdf-search-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: light-dark(
			var(--color-surface-raised, #f8fafc),
			var(--color-surface-raised, #1a2332)
		);
		border-bottom: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		flex-shrink: 0;
	}

	.pdf-search-input {
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		border-radius: var(--radius-sm, 0.25rem);
		font-size: var(--text-sm, 0.875rem);
		background: light-dark(var(--color-surface, #ffffff), var(--color-surface, #1e293b));
		color: var(--color-text, light-dark(#1e293b, #e2e8f0));
	}

	.pdf-search-input:focus {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: -1px;
	}

	.pdf-search-count {
		font-size: var(--text-xs, 0.75rem);
		color: var(--color-text-muted, light-dark(#64748b, #94a3b8));
		white-space: nowrap;
		user-select: none;
	}

	/* ── Pages container ──────────────────────────────────────── */

	.pdf-pages {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	/* ── Page ─────────────────────────────────────────────────── */

	.pdf-page {
		position: relative;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.12), 0 1px 2px rgb(0 0 0 / 0.08);
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

	.pdf-page-placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: white;
	}

	.pdf-page-placeholder-text {
		font-size: 2rem;
		color: light-dark(#cbd5e1, #475569);
		user-select: none;
	}

	/* ── Error state ──────────────────────────────────────────── */

	.pdf-error {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		color: var(--color-text-muted, light-dark(#64748b, #94a3b8));
		padding: 2rem;
		text-align: center;
	}

	.pdf-error-detail {
		font-size: var(--text-sm, 0.875rem);
		max-width: 30rem;
		word-break: break-word;
	}

	/* ── Skeleton ─────────────────────────────────────────────── */

	.pdf-skeleton {
		flex: 1;
		display: flex;
		flex-direction: column;
		pointer-events: none;
	}

	.pdf-skeleton-toolbar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
	}

	.pdf-skeleton-block {
		border-radius: var(--radius-sm, 0.25rem);
		background: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: pdf-shimmer 2s infinite;
		}
	}

	.pdf-skeleton-page {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 2rem;
	}

	.pdf-skeleton-line {
		height: 0.875rem;
		border-radius: var(--radius-sm, 0.25rem);
		background: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: pdf-shimmer 2s infinite;
		}
	}

	@keyframes pdf-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pdf-skeleton-block::after,
		.pdf-skeleton-line::after {
			animation: none;
		}
	}
</style>
