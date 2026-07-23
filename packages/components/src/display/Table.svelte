<script lang="ts" module>
	export interface Column<T> {
		/** The row property to read this column's value from (also used as the column id) */
		key: string;
		/** The header text for this column */
		label: string;
		/** Whether clicking the header sorts the table by this column */
		sortable?: boolean;
		/** CSS width of the column (e.g. `'200px'`, `'2fr'`) */
		width?: string;
		/** CSS minimum width of the column */
		minWidth?: string;
		/** Horizontal alignment of cell content */
		align?: 'left' | 'center' | 'right';
		/** Custom snippet to render the cell content (instead of the plain value) */
		cell?: import('svelte').Snippet<[{ value: unknown; row: T; index: number }]>;
		/** Custom snippet to render the header content (instead of `label`) */
		header?: import('svelte').Snippet<[{ column: Column<T> }]>;

		// ---- Inline editing (only active when the Table's `editable` prop is on) ----
		/** Per-column override of the Table's `editable`. A predicate makes editability
		 * per-cell. Defaults to inheriting the Table's `editable` flag. */
		editable?: boolean | ((row: T) => boolean);
		/** Which editor control to use for this column. A Snippet is a custom editor
		 * (it receives a `CellEditorContext`). Defaults to `'text'`. */
		editor?: CellEditorType | import('svelte').Snippet<[CellEditorContext<T>]>;
		/** Static autocomplete / select options, filtered client-side by the current
		 * value. A `string[]` is shorthand for `{ value }` options. Required (or
		 * `onautocomplete`) for the `'select'` editor. */
		options?: CellOption[] | string[];
		/** Dynamic autocomplete options. Called on focus (with the current value) and
		 * on input (debounced 300ms). Return a list or a Promise of one. */
		onautocomplete?: (
			ctx: CellAutocompleteContext<T>,
		) => CellOption[] | Promise<CellOption[]>;
		/** Fires on every keystroke while editing (not a commit). */
		oninput?: (ctx: CellEditContext<T>) => void;
		/** Commit handler — fires on Enter or blur, only when the value changed. If it
		 * returns a Promise the cell shows a loading spinner; on rejection the cell
		 * keeps the value and shows an error ring so the user can retry. */
		onedit?: (ctx: CellEditContext<T>) => void | Promise<void>;
		/** Inline validation. Return an error message (blocks the commit and shows an
		 * error ring) or `null`/`''` to pass. May be async. */
		validate?: (
			value: unknown,
			row: T,
			index: number,
		) => string | null | Promise<string | null>;
		/** Raw editor string → stored value, applied before the value is committed
		 * (e.g. `Number(raw)`). Defaults to the raw string. */
		parse?: (raw: string, row: T) => unknown;
		/** Stored value → display string. Used for the resting cell text and the
		 * editor's initial text. Defaults to `String(value ?? '')`. */
		format?: (value: unknown, row: T) => string;
		/** Editor placeholder text. */
		placeholder?: string;
	}

	/** Built-in editor controls for an editable column. */
	export type CellEditorType = 'text' | 'number' | 'select' | 'boolean' | 'date';

	/** An autocomplete / select option (mirrors the Input component's options). */
	export interface CellOption {
		/** The value committed when this option is chosen */
		value: string;
		/** Display text for the option (defaults to `value`) */
		label?: string;
		/** Secondary descriptive text shown under the label */
		description?: string;
		/** Whether this option cannot be selected */
		disabled?: boolean;
	}

	/** Passed to `oninput` / `onedit` (and the Table-level `oncellinput` / `oncelledit`). */
	export interface CellEditContext<T> {
		/** The parsed value being committed (post-`parse`), or the live value for `oninput`. */
		value: unknown;
		/** The previous stored value. */
		previous: unknown;
		/** The row object being edited. */
		row: T;
		/** The row index within the table data. */
		index: number;
		/** The column definition of the edited cell. */
		column: Column<T>;
		/** The edited column's `key`. */
		key: string;
	}

	/** Passed to a custom editor Snippet (`column.editor`). */
	export interface CellEditorContext<T> {
		/** The current draft value of the editor. */
		value: unknown;
		/** The row object being edited. */
		row: T;
		/** The row index within the table data. */
		index: number;
		/** The column definition of the edited cell. */
		column: Column<T>;
		/** Update the in-progress draft value. */
		setValue: (value: unknown) => void;
		/** Commit the current draft (runs `parse`/`validate`/`onedit`) and move down. */
		commit: () => void;
		/** Discard the draft and exit editing. */
		cancel: () => void;
	}

	/** Passed to `column.onautocomplete`. */
	export interface CellAutocompleteContext<T> {
		/** The current editor text to filter options by. */
		query: string;
		/** The stored cell value. */
		value: unknown;
		/** The row object being edited. */
		row: T;
		/** The row index within the table data. */
		index: number;
		/** The column definition of the edited cell. */
		column: Column<T>;
	}

	/** Which element provides the scrollbar that drives virtual scrolling.
	 * - `'container'` (default): the Table's own scroll frame
	 * - `'parent'`: the Table's direct parent element
	 * - `'window'`: the page / document
	 * - a CSS selector string or an `HTMLElement`: any scrollable ancestor */
	export type VirtualScroller =
		| 'container'
		| 'parent'
		| 'window'
		| (string & {})
		| HTMLElement;

	export interface VirtualScrollOptions {
		/** Fixed row height in px. Auto-measured from the first row when omitted. */
		row_height?: number;
		/** Extra rows rendered above and below the viewport (default 8). */
		overscan?: number;
		/** Which element scrolls (default `'container'`). */
		scroller?: VirtualScroller;
		/** Bounds the scroll viewport height (e.g. 400 or '60vh'). Only applies to
		 * the `'container'` scroller (defaults to 420px there); ignored for other
		 * scrollers, whose height is owned by the chosen element. */
		max_height?: string | number;
	}

	/** `true` for sensible defaults, `false` to disable, or an options object. */
	export type VirtualScroll = boolean | VirtualScrollOptions;

	/** Pagination appearance + behavior. `true` enables it with sensible defaults
	 * (10 rows/page, a numbered pager with a "Showing X–Y of Z" summary beneath the
	 * table); pass an object to tune it. */
	export interface PaginationConfig {
		/** Pager style: a full numbered pager (default), `'simple'`
		 * (Prev · Page X of Y · Next), or `'compact'` (‹ X / Y ›). */
		variant?: 'default' | 'simple' | 'compact';
		/** Where the pager sits relative to the table (default `'bottom'`). */
		position?: 'top' | 'bottom' | 'both';
		/** Pager alignment. `'between'` (the default) puts the info/summary on the
		 * left and the controls on the right; the others align the whole pager. */
		align?: 'start' | 'center' | 'end' | 'between';
		/** Show the "Showing X–Y of Z" summary (default `true`). */
		show_info?: boolean;
		/** Offer a rows-per-page selector with these options. Providing the list
		 * turns the selector on; omit it to hide it. */
		page_size_options?: number[];
		/** Total row count for SERVER-side pagination. When set, the Table treats
		 * `data` as ALREADY being the current page (it does not slice) and derives
		 * the page count from this — bind `page`/`page_size` or use `onpagechange`
		 * to fetch each page yourself. */
		total_items?: number;
		/** Sibling pages shown either side of the current page (default `1`). */
		sibling_count?: number;
		/** Pages always shown at the start and end (default `1`). */
		boundary_count?: number;
		/** Pager button size (default `'1'`). */
		size?: '0' | '1' | '2' | '3';
	}
</script>

<script lang="ts" generics="T extends Record<string, unknown>">
	import type { Snippet } from 'svelte';
	import { tick, flushSync } from 'svelte';
	import { ripple } from '@delightstack/utilities';
	import { scrollbar } from '../actions/scrollbar';
	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import Progress from '../feedback/Progress.svelte';
	import Pagination from '../navigation/Pagination.svelte';
	import TableCellEditor from './TableCellEditor.svelte';

	const propId = $props.id();

	let {
		/** Array of row data */
		data = [] as T[],

		/** Column definitions */
		columns = [] as Column<T>[],

		/** Stable per-row identity used as the keyed-`{#each}` key. Pass a field
		 * name (`'id'`) or a function (`(row) => row.id`). When set, reordering and
		 * re-sorting MOVE each row's existing DOM node to follow its data instead of
		 * re-keying rows by position — so selection checkmarks (and any per-row DOM
		 * state) ride along with the row rather than redrawing when the parent
		 * commits a new order. Defaults to the row's position, which is fine for
		 * static tables but makes checkmarks flash on `reorderable` commits. Strongly
		 * recommended whenever `reorderable` and `selectable` are combined. */
		row_key = undefined as string | ((row: T) => string | number) | undefined,

		/** Current sort column key */
		sort_by = $bindable(undefined) as string | undefined,

		/** Sort direction */
		sort_direction = $bindable('asc') as 'asc' | 'desc',

		/** Enable row selection */
		selectable = false,

		/** Selected rows */
		selected = $bindable([]) as T[],

		/** Alternating row backgrounds */
		striped = false,

		/** Compact padding */
		dense = false,

		/** Relaxed padding */
		comfortable = false,

		/** Sticky header */
		sticky_header = true,

		/** Enable column resizing — drag any column border (in the header or the
		 * body cells) to resize; double-click a border to auto-fit. */
		resizable = false,

		/** Row expansion */
		expandable = false,

		/** Group rows by column key */
		group_by = undefined as string | undefined,

		/** Enable CSV/JSON export */
		exportable = false,

		/** Loading skeleton */
		skeleton = false,

		/** Skeleton rows */
		skeleton_count = 5,

		/** Virtual scrolling. `true` enables it with sensible defaults, `false`
		 * disables it, or pass an options object — `{ row_height, overscan, scroller,
		 * max_height }`. Windows the rows so only those near the viewport render,
		 * keeping tables with thousands of rows fast. Applies to the flat
		 * (non-grouped) data path. The `scroller` option chooses what scrolls:
		 * the Table's own frame (default), its parent, the window, or any element. */
		virtual_scroll = false as VirtualScroll,

		/** Pagination. `true` turns it on with sensible defaults — 10 rows per page
		 * and a numbered pager with a "Showing X–Y of Z" summary beneath the table.
		 * Pass a config object to tune the look/behavior (`{ variant, position,
		 * align, show_info, page_size_options, total_items, sibling_count,
		 * boundary_count, size }`). By default the Table slices `data` to the current
		 * page for you (client-side). For SERVER-side paging, set `total_items` in
		 * the config and feed the Table only the current page, then bind `page` /
		 * `page_size` (or use `onpagechange`) to fetch. While active, pagination
		 * disables `virtual_scroll` and `reorderable`. */
		pagination = false as boolean | PaginationConfig,

		/** Current page, 1-based (bindable). */
		page = $bindable(1),

		/** Rows per page (bindable). */
		page_size = $bindable(10),

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

		/** Custom empty state */
		empty = undefined as Snippet | undefined,

		/** Expanded row content */
		expanded_row = undefined as Snippet<[T]> | undefined,

		/** Sort changed */
		onsort = undefined as
			| ((payload: { column: string; direction: 'asc' | 'desc' }) => void)
			| undefined,

		/** Selection changed */
		onselect = undefined as ((payload: { selected: T[] }) => void) | undefined,

		/** Row clicked */
		onrowclick = undefined as ((payload: { row: T; index: number }) => void) | undefined,

		/** Column resized */
		oncolumnresize = undefined as
			| ((payload: { column: string; width: number }) => void)
			| undefined,

		/** Enable drag-to-reorder rows. On desktop a press-and-drag reorders
		 * immediately (a plain click still selects); on touch the row must be
		 * held briefly (long-press) before it lifts, so normal scrolling is
		 * preserved. Works alongside `selectable` (drag the whole selection at
		 * once) and `virtual_scroll`. Disabled while `group_by` is set. */
		reorderable = false,

		/** Reorder committed — fires AFTER the drop animation has finished, so the
		 * parent can swap in the new order without interrupting the animation.
		 * Assign `payload.newData` to your `data`. `from` is the moved rows' data
		 * indices (in visual order); `to` is the index in the new array where the
		 * block was inserted. */
		onreorder = undefined as
			| ((payload: { from: number[]; to: number; oldData: T[]; newData: T[] }) => void)
			| undefined,

		/** A reorder drag began (the row(s) lifted). */
		onreorderstart = undefined as ((payload: { from: number[] }) => void) | undefined,

		/** The row(s) were released — fires when the drop animation BEGINS, before
		 * `onreorder` commits. Useful for haptics/analytics. */
		ondrop = undefined as ((payload: { from: number[]; to: number }) => void) | undefined,

		/** Enable inline cell editing. Turns on the spreadsheet-style edit UX:
		 * focusing a cell (click or Tab) opens an inline editor, arrow keys / Tab move
		 * between cells, and hover highlights the cell (not the whole row). Each column
		 * opts in/out via `column.editable` and configures its editor + `onedit`
		 * callback. The Table stays controlled: editing fires `onedit`; the parent
		 * updates `data` (an optimistic value is shown while an async `onedit` runs). */
		editable = false,

		/** Table-wide commit handler — fires when a cell is edited and its column has no
		 * own `onedit`. May return a Promise (→ in-cell spinner). */
		oncelledit = undefined as
			| ((ctx: CellEditContext<T>) => void | Promise<void>)
			| undefined,

		/** Table-wide per-keystroke handler — fallback when a column has no own `oninput`. */
		oncellinput = undefined as ((ctx: CellEditContext<T>) => void) | undefined,

		/** The page or page size changed. Fires for both client- and server-side
		 * paging — use it to fetch the next page when you manage `data` yourself. */
		onpagechange = undefined as
			| ((payload: { page: number; page_size: number }) => void)
			| undefined,
	} = $props();

	// ---- Internal state ----
	let columnWidths = $state<Record<string, number>>({});
	let resizing = $state<{
		column_key: string;
		start_x: number;
		start_width: number;
	} | null>(null);
	// Column whose border the mouse is hovering (via the boundary hit zones, in the
	// header or any body cell). Drives the full-height boundary preview — set only
	// while the pointer is inside a resize zone, so the accent never shows when the
	// mouse is merely somewhere over the column.
	let hoveredResizeKey = $state<string | null>(null);
	let expandedRows = $state(new Set<number>());
	let collapsedGroups = $state(new Set<string>());
	// Anchor + hovered row tracked as VISUAL positions so shift-range follows the
	// rows as displayed (after sorting/grouping), not their order in `data`.
	let lastSelectedVisual = $state<number | null>(null);
	let showExportMenu = $state(false);

	// ---- Inline editing state ----
	// The active cell + the roving (tab-entry) cell are tracked by STABLE identity
	// (`row_id` from `keyOf`, plus column key), so they survive sort/reorder and a
	// virtual-scroll remount. Per-cell async state is keyed by `${row_id}:${col_key}`
	// (never row object identity — selection proxies, see `shallowEqual`).
	interface CellRef {
		row_id: string | number;
		col_key: string;
	}
	interface CellEdit {
		row_id: string | number;
		col_key: string;
		prev: unknown;
		next: unknown;
	}
	let active_cell = $state<CellRef | null>(null);
	let roving_cell = $state<CellRef | null>(null);
	let cellOptimistic = $state(new Map<string, unknown>()); // draft shown while saving
	let cellPending = $state(new Set<string>()); // async save in flight → spinner
	let cellError = $state(new Map<string, string>()); // failed save → error ring + msg
	let cellSaved = $state(new Set<string>()); // brief success flash
	let undoStack: CellEdit[] = [];
	let redoStack: CellEdit[] = [];

	// ---- Virtual scrolling state ----
	let wrapperEl = $state<HTMLDivElement | null>(null);
	let scrollEl = $state<HTMLDivElement | null>(null);
	let tableEl = $state<HTMLTableElement | null>(null);
	let resolvedScroller = $state<HTMLElement | Window | null>(null);
	// Body offset (px the row list has scrolled past the viewport top) and the
	// scroller's visible height — recomputed from geometry on scroll/resize, so
	// the same windowing math works whether the container frame, the page, or a
	// custom ancestor is the thing scrolling.
	let virtualOffset = $state(0);
	let virtualViewport = $state(0);
	let measuredRowHeight = $state<number | null>(null);
	let measuredHeaderHeight = $state(0);
	// Measured heights of expanded detail blocks (keyed by data_index) so the
	// windowing math can fold their extra height into the scroll offsets.
	let expandedHeights = $state(new Map<number, number>());

	// Shift-range preview state
	let shiftHeld = $state(false);
	let hoverIndex = $state<number | null>(null);

	// ---- Reorder (drag-to-reorder) state ----
	// Reactive bits the template reads:
	let reorderDragging = $state(false); // a row is actively being dragged
	let reorderDropping = $state(false); // the drop/settle animation is running
	let armedDataIndex = $state<number | null>(null); // touch long-press armed this row
	// data_index → translateY (px) applied to non-dragged rows to open the gap
	let rowTransforms = $state(new Map<number, number>());
	// data_index set of the rows currently lifted out (rendered hidden as placeholders)
	let draggedDataSet = $state(new Set<number>());
	// The lifted row(s) cloned into the floating overlay (in visual order). When
	// dragging many rows the overlay collapses to a single card; `overlayMore`
	// then holds the total count for the "N" badge (0 = show every dragged row).
	let overlayRows = $state<{ row: T; data_index: number }[]>([]);
	let overlayMore = $state(0);
	let overlayEl = $state<HTMLDivElement | null>(null);
	let suppressNextClick = false; // swallow the click that follows a drag

	// Above this many dragged rows the overlay collapses to one card + a badge,
	// so the floating element stays compact (the gap still reserves every row).
	const REORDER_COLLAPSE_AT = 4;

	// Non-reactive per-gesture context (mutated at ~60fps; kept off $state to
	// avoid reactivity churn — the template only reads the $state above).
	interface DragContext {
		pointer_id: number;
		pointer_type: string;
		start_client_x: number;
		start_client_y: number;
		last_client_x: number;
		last_client_y: number;
		grab_vi: number; // visual index of the grabbed row
		grab_row_top: number; // grabbed row's client top at pointer-down
		grab_within_block: number; // px from block top to the grab point
		grab_row_offset_in_block: number; // px from block top to the grabbed row's top
		// How the overlay tracks the finger / settles, so a collapsed (single-card)
		// overlay lands on the grabbed row's slot rather than the whole block's top.
		overlay_grab_offset: number; // px from overlay top to the grab point
		overlay_top_content_offset: number; // px from block top to overlay top
		collapsed: boolean; // overlay shows one card + a count badge
		dragged_vis: number[]; // visual indices being dragged (ascending)
		dragged_set: Set<number>; // same, as a Set for O(1) lookups
		dragged_rows: T[]; // the row objects, in visual order
		dragged_row_set: Set<T>;
		virtual: boolean;
		rh: number; // uniform row height used in virtual mode
		total: number; // total row count
		block_height: number;
		// Non-virtual measured layout, indexed by visual index (content-space,
		// body-top = 0). The "delta" model preserves each row's measured position
		// and only shifts it by the dragged height removed above it plus the block
		// height inserted above it — so interleaved expanded rows stay correct.
		top_by_vi: number[]; // vi → measured top
		h_by_vi: number[]; // vi → measured height
		removed_above: number[]; // vi → total dragged height with a smaller vi
		r_rank: number[]; // vi → rank among non-dragged rows
		r_vis: number[]; // non-dragged visual indices, in order
		insert_at: number; // current insertion index (R-space)
		last_insert_at: number;
		block_top_content: number; // content-Y where the block will land
		// Drag direction (with hysteresis) so the insert threshold is the row's top
		// when moving down and its bottom when moving up — symmetric 50%-overlap.
		prev_center: number | null;
		move_dir: 1 | -1; // 1 = down, -1 = up
		armed: boolean;
		hold_timer: number | null;
		raf: number | null;
		settling: boolean;
		settle_timeout: number | null;
	}
	let drag: DragContext | null = null;

	const HOLD_DELAY = 240; // ms long-press before a touch drag arms
	const SCROLL_TOLERANCE = 10; // px of pre-arm movement that means "scrolling"
	const DRAG_THRESHOLD = 5; // px of movement (mouse) before a drag starts
	const EDGE_SIZE = 56; // px edge band that triggers auto-scroll
	const MAX_SCROLL_SPEED = 18; // px per frame at the very edge
	const SETTLE_MS = 300; // drop animation duration
	const SETTLE_EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
	const LIFT_SCALE = 1.025; // "popped above" scale while dragging (centred)
	const LIFT_IN_MS = 150; // ms to ease from the press into the lifted overlay
	const LIFT_IN_EASE = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
	// The overlay starts its lift from the grabbed row's pressed scale (mouse) so
	// the float grows out of the :active push instead of snapping in. The pressed
	// scale is width-dependent — `.row.clickable:active` shrinks the row by a fixed
	// pixel amount (--press-shrink), not a fixed ratio — so it is recomputed from
	// the scroller width at grab time. Keep these in sync with that CSS formula.
	const PRESS_SHRINK_PX = 20; // matches --press-shrink
	const MIN_PRESS_SCALE = 0.9; // matches the CSS clamp() floor
	const PRESS_SCALE_Y = 0.85; // matches --press-scale-y

	function clamp(n: number, min: number, max: number): number {
		return n < min ? min : n > max ? max : n;
	}

	// Mirrors the CSS press: scale = 1 - shrink/width, floored like the clamp().
	function pressScaleFor(width: number): number {
		return width > 0 ? clamp(1 - PRESS_SHRINK_PX / width, MIN_PRESS_SCALE, 1) : 1;
	}

	// ---- Reduced motion ----
	function prefersReducedMotion(): boolean {
		return (
			typeof window !== 'undefined' &&
			!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
		);
	}

	// ---- Track Shift for range preview (only while selectable) ----
	$effect(() => {
		if (!selectable) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Shift') shiftHeld = e.type === 'keydown';
		}
		function onBlur() {
			shiftHeld = false;
		}
		window.addEventListener('keydown', onKey);
		window.addEventListener('keyup', onKey);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keyup', onKey);
			window.removeEventListener('blur', onBlur);
		};
	});

	// ---- Measure header + row height for virtual scrolling ----
	// The window math assumes a uniform row height; measuring the rendered header
	// and first body row keeps it accurate across density modes without the
	// consumer having to supply `row_height`.
	$effect(() => {
		if (!virtualActive) return;
		// Re-measure when density changes.
		void dense;
		void comfortable;
		const head = tableEl?.querySelector('thead tr') as HTMLElement | null;
		if (head) {
			const hh = head.getBoundingClientRect().height;
			if (hh && hh !== measuredHeaderHeight) measuredHeaderHeight = hh;
		}
		if (vOpts.row_height == null) {
			const el = tableEl?.querySelector('tbody tr.row') as HTMLElement | null;
			if (el) {
				const h = el.getBoundingClientRect().height;
				if (h && h !== measuredRowHeight) measuredRowHeight = h;
			}
		}
		measureViewport();
	});

	// ---- Resolve which element scrolls ----
	$effect(() => {
		if (!virtualActive) {
			resolvedScroller = null;
			return;
		}
		const s = vOpts.scroller;
		let el: HTMLElement | Window | null = null;
		if (s === 'window') el = window;
		else if (s === 'container') el = scrollEl;
		else if (s === 'parent') el = wrapperEl?.parentElement ?? null;
		else if (typeof s === 'string') el = document.querySelector<HTMLElement>(s);
		else if (s instanceof HTMLElement) el = s;
		if (!el && typeof s === 'string' && s !== 'parent') {
			console.warn(`[Table] virtual_scroll scroller "${s}" matched no element.`);
		}
		resolvedScroller = el;
	});

	// ---- Track the scroller's scroll position + viewport height ----
	$effect(() => {
		if (!virtualActive) return;
		const scroller = resolvedScroller;
		if (!scroller) return;
		let raf = 0;
		const onScroll = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				measureViewport();
			});
		};
		measureViewport();
		scroller.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		let ro: ResizeObserver | undefined;
		if (!(scroller instanceof Window)) {
			ro = new ResizeObserver(onScroll);
			ro.observe(scroller);
		}
		return () => {
			scroller.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			if (raf) cancelAnimationFrame(raf);
			ro?.disconnect();
		};
	});

	// Recompute how far the row list has scrolled past the viewport top, in the
	// scrolling element's coordinate space. The list begins at
	// `tableTop + headerHeight`; its offset below the viewport top is therefore
	// `viewportTop - listTop`. This is geometry-based (not `scrollTop`-based), so
	// it works the same for the container frame, the page, or any ancestor — and
	// correctly accounts for any content sitting above the Table.
	function measureViewport() {
		const scroller = resolvedScroller;
		if (!scroller || !tableEl) return;
		let viewportTop: number;
		let viewportH: number;
		if (scroller instanceof Window) {
			viewportTop = 0;
			viewportH = window.innerHeight;
		} else {
			const r = scroller.getBoundingClientRect();
			viewportTop = r.top;
			viewportH = scroller.clientHeight;
		}
		const listTop = tableEl.getBoundingClientRect().top + measuredHeaderHeight;
		virtualOffset = viewportTop - listTop;
		virtualViewport = viewportH;
	}

	// ---- Sorted data ----
	const sortedData = $derived.by(() => {
		if (!sort_by || onsort) return data;
		const key = sort_by;
		const dir = sort_direction === 'asc' ? 1 : -1;
		return [...data].sort((a, b) => {
			const aVal = a[key];
			const bVal = b[key];
			if (aVal == null && bVal == null) return 0;
			if (aVal == null) return 1;
			if (bVal == null) return -1;
			if (typeof aVal === 'string' && typeof bVal === 'string') {
				return aVal.localeCompare(bVal) * dir;
			}
			if (typeof aVal === 'number' && typeof bVal === 'number') {
				return (aVal - bVal) * dir;
			}
			return String(aVal).localeCompare(String(bVal)) * dir;
		});
	});

	// ---- Pagination ----
	// Slices the sorted rows down to the active page (client-side), or — when
	// `total_items` is supplied — treats `data` as ALREADY being the current page
	// (server-side) and just drives the pager. `flatRows`/`groupedData` build off
	// `renderData` below, so each rendered row's `visual_index` is page-local while
	// its `data_index` stays global (via `rowIndexMap`) — selection and inline
	// editing keep working across pages. Bind `page`/`page_size` to observe/control.
	const pgConfig = $derived.by(() => {
		const o = pagination && pagination !== true ? pagination : {};
		return {
			variant: o.variant ?? 'default',
			position: o.position ?? 'bottom',
			align: o.align ?? 'between',
			show_info: o.show_info ?? true,
			page_size_options: o.page_size_options,
			total_items: o.total_items,
			sibling_count: o.sibling_count ?? 1,
			boundary_count: o.boundary_count ?? 1,
			size: o.size ?? ('1' as '0' | '1' | '2' | '3'),
		};
	});

	const paginationActive = $derived(!!pagination && !skeleton);
	// Server-side mode: `data` is already one page, so we never slice — we only
	// derive the page count and drive the pager (the consumer fetches each page).
	const serverPaginated = $derived(paginationActive && pgConfig.total_items != null);

	const pgTotalItems = $derived(
		serverPaginated ? (pgConfig.total_items ?? 0) : sortedData.length,
	);
	const pgTotalPages = $derived(
		Math.max(1, Math.ceil(pgTotalItems / Math.max(1, page_size))),
	);
	// The pager only shows when there's something to page through.
	const showPager = $derived(paginationActive && pgTotalItems > 0);

	// Keep `page` within range as the data, page size, sort, or filters change.
	$effect(() => {
		if (!paginationActive) return;
		const clamped = clamp(page, 1, pgTotalPages);
		if (clamped !== page) page = clamped;
	});

	// Client-side page slice (server mode renders `sortedData`/`data` as-is).
	const pagedData = $derived.by(() => {
		if (!paginationActive || serverPaginated) return sortedData;
		const start = (page - 1) * page_size;
		return sortedData.slice(start, start + page_size);
	});

	// The rows actually rendered: the page slice when paginating client-side,
	// otherwise the full sorted set.
	const renderData = $derived(
		paginationActive && !serverPaginated ? pagedData : sortedData,
	);

	// ---- Row index map ----
	// Rows in sortedData are the same object references as in `data` (just
	// reordered), so an identity lookup gives each rendered row its stable index
	// in `data`. Selection and expansion key off this stable `data_index` so they
	// survive re-sorting; shift-range selection keys off the visual position.
	const rowIndexMap = $derived.by(() => {
		const m = new Map<T, number>();
		data.forEach((row, i) => m.set(row, i));
		return m;
	});

	// Keyed-each key for a rendered row. A stable `row_key` makes Svelte move the
	// row's DOM node when the order changes (so selection survives a reorder
	// commit without redrawing); falling back to the data index re-keys rows by
	// position, which is fine for tables whose order never changes underneath them.
	function keyOf(row: T, dataIndex: number): string | number {
		if (row_key === undefined) return dataIndex;
		if (typeof row_key === 'function') return row_key(row);
		const v = row[row_key];
		return typeof v === 'string' || typeof v === 'number' ? v : String(v);
	}

	interface RenderRow {
		row: T;
		data_index: number;
		visual_index: number;
	}

	// ---- Grouped data ----
	interface Group {
		key: string;
		label: string;
		rows: RenderRow[];
	}

	const groupedData = $derived.by((): Group[] | null => {
		if (!group_by) return null;
		const groupKey = group_by;
		const map = new Map<string, RenderRow[]>();
		const order: string[] = [];
		for (let i = 0; i < renderData.length; i++) {
			const row = renderData[i];
			const val = String(row[groupKey] ?? 'Other');
			if (!map.has(val)) {
				map.set(val, []);
				order.push(val);
			}
			map.get(val)!.push({ row, data_index: rowIndexMap.get(row) ?? i, visual_index: i });
		}
		return order.map((key) => ({
			key,
			label: key,
			rows: map.get(key)!,
		}));
	});

	// ---- Flat rows for rendering ----
	const flatRows = $derived.by((): RenderRow[] => {
		return renderData.map((row, i) => ({
			row,
			data_index: rowIndexMap.get(row) ?? i,
			visual_index: i,
		}));
	});

	// ---- Virtual scrolling ----
	// Windowing renders only the rows near the viewport (plus an overscan buffer)
	// so tables with thousands of rows stay fast. It engages for the flat,
	// non-grouped data path; grouped/skeleton/empty tables render normally. Heights
	// are uniform (measured, or the `row_height` option); any expanded detail rows
	// are measured and folded into the offset math so scroll positions stay
	// accurate. The `scroller` option chooses which element scrolls.

	// Normalise the `boolean | options` prop to concrete values used below.
	const vOpts = $derived.by(() => {
		const o: VirtualScrollOptions =
			virtual_scroll && virtual_scroll !== true ? virtual_scroll : {};
		return {
			row_height: o.row_height,
			overscan: o.overscan ?? 8,
			scroller: o.scroller ?? 'container',
			max_height: o.max_height,
		};
	});

	const virtualActive = $derived(
		!!virtual_scroll && !group_by && !skeleton && !paginationActive && data.length > 0,
	);

	// The frame owns the scrollbar only for the default `'container'` scroller;
	// for any other scroller an outer element drives the scroll and the frame must
	// not establish its own scroll container (see `.scroll.passthrough`).
	const containerScroll = $derived(virtualActive && vOpts.scroller === 'container');

	const densityRowEstimate = $derived(dense ? 33 : comfortable ? 57 : 45);
	const effectiveRowHeight = $derived(
		vOpts.row_height ?? measuredRowHeight ?? densityRowEstimate,
	);

	// max_height only makes sense for the container scroller; other scrollers own
	// their own height, so it is ignored there.
	const resolvedMaxHeight = $derived.by((): string | undefined => {
		if (!containerScroll) return undefined;
		const mh = vOpts.max_height;
		if (mh != null) return typeof mh === 'number' ? `${mh}px` : mh;
		return '420px';
	});

	// Fallback viewport height for the first render (before the scroller is
	// measured), so the initial window isn't empty during SSR/hydration.
	const initialViewportEstimate = $derived.by((): number => {
		const m = resolvedMaxHeight;
		if (m) {
			const n = parseFloat(m);
			if (Number.isFinite(n)) return n;
		}
		return 600;
	});

	// Expanded detail rows in visual order with their (measured or estimated)
	// extra height — empty unless row expansion is in use.
	const expandedVisual = $derived.by((): { visual_index: number; extra: number }[] => {
		if (!expandable || expandedRows.size === 0) return [];
		const estimate = effectiveRowHeight;
		const out: { visual_index: number; extra: number }[] = [];
		for (let v = 0; v < flatRows.length; v++) {
			const di = flatRows[v].data_index;
			if (expandedRows.has(di)) {
				out.push({ visual_index: v, extra: expandedHeights.get(di) ?? estimate });
			}
		}
		return out;
	});

	interface VirtualWindow {
		first: number;
		last: number;
		top_pad: number;
		bottom_pad: number;
		rows: RenderRow[];
	}

	const virtualWindow = $derived.by((): VirtualWindow | null => {
		if (!virtualActive) return null;
		const rh = effectiveRowHeight;
		const overscan = vOpts.overscan;
		const total = flatRows.length;
		const vh = virtualViewport || initialViewportEstimate;
		const exp = expandedVisual;
		const totalExtra = exp.reduce((s, e) => s + e.extra, 0);

		// Pixel offset of the top of visual row `i` within the body (base rows plus
		// any expanded detail above it). `exp` is sorted by visual_index.
		const topAt = (i: number): number => {
			let extra = 0;
			for (const e of exp) {
				if (e.visual_index < i) extra += e.extra;
				else break;
			}
			return i * rh + extra;
		};

		// Inverse of topAt: the visual row index at a given body pixel offset.
		const indexAt = (offset: number): number => {
			let remaining = offset;
			let idx = 0;
			for (const e of exp) {
				const gap = e.visual_index - idx;
				if (remaining < gap * rh) return idx + Math.floor(remaining / rh);
				remaining -= gap * rh;
				idx = e.visual_index;
				const rowTotal = rh + e.extra;
				if (remaining < rowTotal) return idx;
				remaining -= rowTotal;
				idx += 1;
			}
			return idx + Math.floor(remaining / rh);
		};

		// `virtualOffset` already measures how far the row list has scrolled past
		// the viewport top (header excluded), in the scroller's coordinate space.
		const scroll = Math.max(0, virtualOffset);
		const first = Math.max(0, indexAt(scroll) - overscan);
		const last = Math.min(total, indexAt(scroll + vh) + overscan + 1);
		const contentHeight = total * rh + totalExtra;
		const top_pad = topAt(first);
		const bottom_pad = Math.max(0, contentHeight - topAt(last));
		return { first, last, top_pad, bottom_pad, rows: flatRows.slice(first, last) };
	});

	// When a table is both reorderable and editable, every data cell is
	// `data-no-drag` (a click edits it), so reordering needs an explicit grip handle
	// in its own leading column.
	const reorderGrip = $derived(
		reorderable &&
			editable &&
			!group_by &&
			!skeleton &&
			!paginationActive &&
			data.length > 0,
	);

	// ---- Total columns count ----
	const totalColumns = $derived(
		columns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0) + (reorderGrip ? 1 : 0),
	);

	// ---- Grid track template ----
	// The table renders as a CSS grid (with subgrid rows) instead of a native
	// table layout, so each <tr> is a real block box that can host a row-wide
	// ripple, hover and press effects. The column tracks are declared here so
	// every subgrid row stays aligned.
	const gridTemplateColumns = $derived.by(() => {
		const tracks: string[] = [];
		if (reorderGrip) tracks.push('auto');
		if (selectable) tracks.push('auto');
		if (expandable) tracks.push('auto');
		for (const col of columns) {
			const w = columnWidths[col.key];
			if (w) {
				tracks.push(`${w}px`);
			} else if (col.width) {
				tracks.push(col.width);
			} else if (col.minWidth) {
				tracks.push(`minmax(${col.minWidth}, 1fr)`);
			} else {
				// `min-content` (not max-content) so a full-width spanning cell — e.g.
				// an expanded detail row with long wrapping text — can't inflate the
				// column tracks. For the nowrap data cells min-content == max-content,
				// so columns still size to fit their content.
				tracks.push('minmax(min-content, 1fr)');
			}
		}
		return tracks.join(' ');
	});

	// ---- Selection identity ----
	// `selected` round-trips through the consumer's binding, which is often a
	// `$state` array. Svelte deeply proxies state, so the objects read back out
	// are proxies whose identity no longer `===` the raw rows in `data`. We
	// therefore track selection by row index (matched identity-first, then by a
	// shallow value compare so proxied rows still resolve to their data index).
	function shallowEqual(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
			return false;
		}
		const ak = Object.keys(a as Record<string, unknown>);
		const bk = Object.keys(b as Record<string, unknown>);
		if (ak.length !== bk.length) return false;
		for (const k of ak) {
			if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) {
				return false;
			}
		}
		return true;
	}

	const selectedIndexSet = $derived.by((): Set<number> => {
		const set = new Set<number>();
		if (!selectable || selected.length === 0) return set;
		for (const sel of selected) {
			let idx = data.indexOf(sel as T);
			if (idx === -1) idx = data.findIndex((d) => shallowEqual(d, sel));
			if (idx !== -1) set.add(idx);
		}
		return set;
	});

	function isSelectedIndex(index: number): boolean {
		return selectedIndexSet.has(index);
	}

	// ---- Select all state ----
	const allSelected = $derived(data.length > 0 && selectedIndexSet.size === data.length);
	const someSelected = $derived(
		selectedIndexSet.size > 0 && selectedIndexSet.size < data.length,
	);

	// ---- Shift-range preview ----
	// Preview range is expressed in VISUAL positions (the rows between the anchor
	// and the hovered row, inclusive).
	const previewRange = $derived.by((): Set<number> | null => {
		if (!selectable || !shiftHeld || lastSelectedVisual === null || hoverIndex === null) {
			return null;
		}
		const start = Math.min(lastSelectedVisual, hoverIndex);
		const end = Math.max(lastSelectedVisual, hoverIndex);
		const set = new Set<number>();
		for (let i = start; i <= end; i++) set.add(i);
		return set;
	});

	function isPreviewingVisual(visualIndex: number): boolean {
		return previewRange?.has(visualIndex) ?? false;
	}

	// ---- Sorting ----
	function handleSort(columnKey: string) {
		const col = columns.find((c) => c.key === columnKey);
		if (!col?.sortable) return;

		let newDirection: 'asc' | 'desc' = 'asc';
		let newSortBy: string | undefined = columnKey;

		if (sort_by === columnKey) {
			if (sort_direction === 'asc') {
				newDirection = 'desc';
			} else {
				// Third click: clear sort
				newSortBy = undefined;
				newDirection = 'asc';
			}
		}

		if (onsort) {
			onsort({ column: newSortBy ?? columnKey, direction: newDirection });
		} else {
			sort_by = newSortBy;
			sort_direction = newDirection;
		}
	}

	function headerJustify(col: Column<T>): string {
		if (col.align === 'right') return 'flex-end';
		if (col.align === 'center') return 'center';
		return 'flex-start';
	}

	// ---- Selection ----
	// `selected` is rebuilt from `data` by index on every change so it always
	// holds real `data` rows (never stale proxies), keeping membership reliable.
	function emitSelected(indices: Set<number>) {
		selected = [...indices].sort((a, b) => a - b).map((i) => data[i]);
		onselect?.({ selected });
	}

	function toggleSelectAll() {
		if (allSelected) {
			emitSelected(new Set());
		} else {
			emitSelected(new Set(data.map((_, i) => i)));
		}
	}

	function handleSelectAllKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			toggleSelectAll();
		}
	}

	function toggleSelectRow(
		dataIndex: number,
		visualIndex: number,
		event?: MouseEvent | KeyboardEvent,
	) {
		const next = new Set(selectedIndexSet);
		if (event?.shiftKey && lastSelectedVisual !== null) {
			// Select the visually-contiguous range, mapping each displayed row back
			// to its stable data index.
			const start = Math.min(lastSelectedVisual, visualIndex);
			const end = Math.max(lastSelectedVisual, visualIndex);
			for (let v = start; v <= end; v++) {
				const di = rowIndexMap.get(renderData[v]);
				if (di !== undefined) next.add(di);
			}
			// Keep the anchor so the range can be re-extended with another shift-click.
		} else {
			if (next.has(dataIndex)) {
				next.delete(dataIndex);
			} else {
				next.add(dataIndex);
			}
			lastSelectedVisual = visualIndex;
		}
		emitSelected(next);
	}

	function handleRowCheckKeydown(
		e: KeyboardEvent,
		dataIndex: number,
		visualIndex: number,
	) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			toggleSelectRow(dataIndex, visualIndex, e);
		}
	}

	// ---- Column resizing ----
	// Unified across mouse / touch / pen via Pointer Events + pointer capture, so
	// the drag keeps tracking even when the pointer slides off the thin handle.
	// The handle straddles the 1px divider with a few px of slack on each side
	// (see `.resize-handle`), so you never have to land on the hairline itself.
	const RESIZE_MIN_FALLBACK = 60;

	function colMinWidth(columnKey: string): number {
		const col = columns.find((c) => c.key === columnKey);
		const n = parseInt(col?.minWidth || '', 10);
		return Number.isFinite(n) && n > 0 ? n : RESIZE_MIN_FALLBACK;
	}

	// Current rendered width of a column, looked up BY KEY via its header cell —
	// not by the handle's own cell, because a left-edge zone resizes the *previous*
	// column and so must measure that column, not the cell it lives in. Falls back
	// to the explicit override / a constant when the header isn't measurable.
	function currentColWidth(columnKey: string): number {
		if (columnWidths[columnKey]) return columnWidths[columnKey];
		const th = tableEl?.querySelector<HTMLElement>(
			`th[data-col-key="${CSS.escape(columnKey)}"]`,
		);
		return th ? Math.round(th.getBoundingClientRect().width) : 100;
	}

	function startResize(e: PointerEvent, columnKey: string) {
		// Mouse: primary button only. Touch / pen: always.
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();

		const handle = e.currentTarget as HTMLElement;
		const minW = colMinWidth(columnKey);
		const startWidth = currentColWidth(columnKey);
		resizing = { column_key: columnKey, start_x: e.clientX, start_width: startWidth };
		hoveredResizeKey = null; // the active highlight takes over from the hover preview
		// Capture so pointermove/up keep firing on the handle even off-target.
		try {
			handle.setPointerCapture(e.pointerId);
		} catch {
			/* capture is best-effort */
		}

		function onMove(ev: PointerEvent) {
			if (!resizing) return;
			const next = Math.max(
				minW,
				Math.round(resizing.start_width + (ev.clientX - resizing.start_x)),
			);
			columnWidths[resizing.column_key] = next;
		}

		function finish(commit: boolean) {
			if (resizing) {
				const finalWidth = columnWidths[resizing.column_key];
				// Only announce a real change — a plain click on the handle (down then
				// up, no movement) shouldn't fire a no-op resize event.
				if (commit && finalWidth && finalWidth !== resizing.start_width) {
					oncolumnresize?.({ column: resizing.column_key, width: finalWidth });
				}
			}
			resizing = null;
			try {
				handle.releasePointerCapture(e.pointerId);
			} catch {
				/* ignore */
			}
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onUp);
			handle.removeEventListener('pointercancel', onCancel);
			window.removeEventListener('keydown', onKey);
		}

		function onUp() {
			finish(true);
		}
		function onCancel() {
			finish(false);
		}
		// Escape mid-drag snaps the column back to where it started.
		function onKey(ev: KeyboardEvent) {
			if (ev.key === 'Escape' && resizing) {
				columnWidths[resizing.column_key] = resizing.start_width;
				finish(false);
			}
		}

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp);
		handle.addEventListener('pointercancel', onCancel);
		window.addEventListener('keydown', onKey);
	}

	// Double-click / Enter / Home on the handle: drop the explicit width so the
	// column returns to its content-driven (auto / flex) size.
	function autoFitColumn(e: Event, columnKey: string) {
		e.preventDefault();
		e.stopPropagation();
		if (!(columnKey in columnWidths)) return;
		const next = { ...columnWidths };
		delete next[columnKey];
		columnWidths = next;
	}

	// Keyboard resizing from a focused handle (WAI-ARIA separator pattern):
	// arrow keys nudge, Shift = larger step, Home/Enter auto-fits.
	function nudgeColumn(columnKey: string, delta: number) {
		const minW = colMinWidth(columnKey);
		const next = Math.max(minW, Math.round(currentColWidth(columnKey) + delta));
		columnWidths[columnKey] = next;
		oncolumnresize?.({ column: columnKey, width: next });
	}

	function handleResizeKeydown(e: KeyboardEvent, columnKey: string) {
		const step = e.shiftKey ? 32 : 12;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			nudgeColumn(columnKey, -step);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			nudgeColumn(columnKey, step);
		} else if (e.key === 'Home' || e.key === 'Enter') {
			e.preventDefault();
			autoFitColumn(e, columnKey);
		}
	}

	// One delegated `mouseover` on the table tracks which column boundary the mouse
	// is over (the handles carry `data-resize-key`). Cheaper than a pair of
	// enter/leave listeners on every cell's hit zone, and it powers the full-height
	// hover preview that fires only inside a zone — not across the whole column.
	function onResizeHover(e: MouseEvent) {
		if (resizing) return;
		const handle = (e.target as HTMLElement)?.closest?.(
			'.resize-handle',
		) as HTMLElement | null;
		const key = handle?.dataset.resizeKey ?? null;
		if (key !== hoveredResizeKey) hoveredResizeKey = key;
	}

	// ---- Row expansion ----
	function toggleExpand(index: number) {
		const next = new Set(expandedRows);
		if (next.has(index)) {
			next.delete(index);
		} else {
			next.add(index);
		}
		expandedRows = next;
	}

	// Measure an expanded detail block so virtual-scroll offsets can account for
	// its height. No-op unless virtual scrolling is active; the observer is torn
	// down when the row collapses (node removed).
	function measureExpanded(dataIndex: number) {
		return (node: HTMLElement) => {
			if (!virtualActive) return;
			const update = () => {
				const h = node.getBoundingClientRect().height;
				if (h && expandedHeights.get(dataIndex) !== h) {
					const next = new Map(expandedHeights);
					next.set(dataIndex, h);
					expandedHeights = next;
				}
			};
			update();
			const ro = new ResizeObserver(update);
			ro.observe(node);
			return () => ro.disconnect();
		};
	}

	// ---- Group collapse ----
	function toggleGroup(groupKey: string) {
		const next = new Set(collapsedGroups);
		if (next.has(groupKey)) {
			next.delete(groupKey);
		} else {
			next.add(groupKey);
		}
		collapsedGroups = next;
	}

	// ---- Row click ----
	function handleRowClick(
		row: T,
		dataIndex: number,
		visualIndex: number,
		event: MouseEvent,
	) {
		// Swallow the click that the browser fires at the end of a drag so it
		// doesn't also toggle selection / fire onrowclick.
		if (suppressNextClick) {
			suppressNextClick = false;
			return;
		}
		const target = event.target as HTMLElement;
		// Clicks on the checkbox, expand toggle, a column-resize border, or an
		// editable cell are handled by those controls — never treat them as a row
		// click (so clicking a cell to edit doesn't also select/expand the row).
		if (
			target.closest('.check-wrap') ||
			target.closest('.expand-btn') ||
			target.closest('.resize-handle') ||
			target.closest('.editable-cell')
		) {
			return;
		}

		if (selectable) {
			toggleSelectRow(dataIndex, visualIndex, event);
			onrowclick?.({ row, index: dataIndex });
			return;
		}

		if (expandable) {
			toggleExpand(dataIndex);
		}
		onrowclick?.({ row, index: dataIndex });
	}

	// ---- Export ----
	function exportCSV() {
		const headers = columns.map((c) => c.label);
		const rows = data.map((row) =>
			columns.map((col) => {
				const val = row[col.key];
				const str = val == null ? '' : String(val);
				// Escape quotes and wrap in quotes if contains comma/quote/newline
				if (str.includes(',') || str.includes('"') || str.includes('\n')) {
					return `"${str.replace(/"/g, '""')}"`;
				}
				return str;
			}),
		);
		const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
		downloadFile(csv, 'table-export.csv', 'text/csv');
		showExportMenu = false;
	}

	function exportJSON() {
		const exportData = data.map((row) => {
			const obj: Record<string, unknown> = {};
			for (const col of columns) {
				obj[col.key] = row[col.key];
			}
			return obj;
		});
		const json = JSON.stringify(exportData, null, 2);
		downloadFile(json, 'table-export.json', 'application/json');
		showExportMenu = false;
	}

	function downloadFile(content: string, filename: string, mimeType: string) {
		const blob = new Blob([content], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	// ---- Cell alignment ----
	// Width/min-width are handled by the grid tracks (see gridTemplateColumns).
	// Cells are flex containers, so alignment maps to justify-content (text-align
	// is kept for any wrapping content).
	function getColumnStyle(col: Column<T>): string {
		if (!col.align) return '';
		const justify =
			col.align === 'right'
				? 'flex-end'
				: col.align === 'center'
					? 'center'
					: 'flex-start';
		return `justify-content: ${justify}; text-align: ${col.align}`;
	}

	// ---- Cell value access ----
	function getCellValue(row: T, key: string): unknown {
		return row[key];
	}

	// ============================================================
	//  Inline editing
	// ============================================================
	const cellKey = (rowId: string | number, colKey: string) => `${rowId}:${colKey}`;

	// Reactivity-safe Map/Set updates (plain Map/Set aren't deeply reactive in
	// Svelte 5 — reassign a clone, matching `expandedRows`/`expandedHeights`).
	function setMap<V>(m: Map<string, V>, k: string, v: V): Map<string, V> {
		const n = new Map(m);
		n.set(k, v);
		return n;
	}
	function delMap<V>(m: Map<string, V>, k: string): Map<string, V> {
		const n = new Map(m);
		n.delete(k);
		return n;
	}
	function addSet(s: Set<string>, k: string): Set<string> {
		const n = new Set(s);
		n.add(k);
		return n;
	}
	function delSet(s: Set<string>, k: string): Set<string> {
		const n = new Set(s);
		n.delete(k);
		return n;
	}

	function resolveEditable(col: Column<T>, row: T): boolean {
		if (!editable) return false;
		const e = col.editable;
		if (e === undefined) return true;
		if (typeof e === 'function') return e(row);
		return e;
	}
	function editableColsFor(row: T): Column<T>[] {
		if (!editable) return [];
		return columns.filter((c) => resolveEditable(c, row));
	}
	function formatCell(col: Column<T>, value: unknown, row: T): string {
		if (col.format) return col.format(value, row);
		return value == null ? '' : String(value);
	}
	function editorTypeOf(col: Column<T>): string {
		return typeof col.editor === 'string' ? col.editor : 'text';
	}

	// Ordered navigable rows for the active render mode. Group-header and expanded
	// detail rows carry no editable cells, so flattening the data-row lists skips
	// them automatically (we never navigate by DOM sibling order).
	const navRows = $derived.by((): RenderRow[] => {
		if (!editable) return [];
		if (groupedData) {
			const out: RenderRow[] = [];
			for (const g of groupedData) {
				if (collapsedGroups.has(g.key)) continue;
				out.push(...g.rows);
			}
			return out;
		}
		return flatRows;
	});

	const activeKey = $derived(
		active_cell ? cellKey(active_cell.row_id, active_cell.col_key) : null,
	);

	function isActiveCell(rowId: string | number, colKey: string): boolean {
		return (
			!!active_cell && active_cell.row_id === rowId && active_cell.col_key === colKey
		);
	}
	function isRovingCell(rowId: string | number, colKey: string): boolean {
		return (
			!active_cell &&
			!!roving_cell &&
			roving_cell.row_id === rowId &&
			roving_cell.col_key === colKey
		);
	}

	// Keep `roving_cell` (the single tabbable entry point when idle) pointing at a
	// real editable cell. Re-validates when the data/columns change.
	$effect(() => {
		if (!editable) return;
		const valid =
			roving_cell &&
			navRows.some(
				(r) =>
					keyOf(r.row, r.data_index) === roving_cell!.row_id &&
					editableColsFor(r.row).some((c) => c.key === roving_cell!.col_key),
			);
		if (valid) return;
		const first = navRows[0];
		const col = first && editableColsFor(first.row)[0];
		roving_cell =
			first && col
				? { row_id: keyOf(first.row, first.data_index), col_key: col.key }
				: null;
	});

	// Commit-and-scroll: when the active cell's row scrolls out of the virtual
	// window it unmounts (the editor commits a dirty draft in its onDestroy), so
	// drop the active state rather than leaving a stale editor reference.
	$effect(() => {
		if (!editable || !active_cell || !virtualActive) return;
		const vw = virtualWindow;
		if (!vw) return;
		const pos = navRows.findIndex(
			(r) => keyOf(r.row, r.data_index) === active_cell!.row_id,
		);
		if (pos < 0) return;
		const vi = navRows[pos].visual_index;
		if (vi < vw.first || vi >= vw.last) active_cell = null;
	});

	function navPosition(
		ref: CellRef,
	): { row: number; col: number; cols: Column<T>[] } | null {
		const rowPos = navRows.findIndex((r) => keyOf(r.row, r.data_index) === ref.row_id);
		if (rowPos < 0) return null;
		const cols = editableColsFor(navRows[rowPos].row);
		const colPos = cols.findIndex((c) => c.key === ref.col_key);
		if (colPos < 0) return null;
		return { row: rowPos, col: colPos, cols };
	}
	function isFirstNavCell(ref: CellRef): boolean {
		const p = navPosition(ref);
		return !!p && p.row === 0 && p.col === 0;
	}
	function isLastNavCell(ref: CellRef): boolean {
		const p = navPosition(ref);
		return !!p && p.row === navRows.length - 1 && p.col === p.cols.length - 1;
	}

	// Whether the next-mounted editor should auto-open its autocomplete panel.
	// Entering a cell DELIBERATELY (click / Tab-focus) opens the menu — that's
	// what the user asked for. Arriving via a keyboard ADVANCE (Enter/Tab/arrow
	// commit moving to the next cell) only moves focus; the menu stays closed
	// until the user types (or presses Alt+ArrowDown), so committing a select
	// doesn't cascade an unexpected open menu down the column.
	let autoOpenEditorMenu = $state(true);

	function enterEdit(rowId: string | number, colKey: string) {
		if (!editable) return;
		autoOpenEditorMenu = true;
		active_cell = { row_id: rowId, col_key: colKey };
		roving_cell = { row_id: rowId, col_key: colKey };
	}
	// Identity-guarded: only clears when the cell that asked to exit is still active,
	// so the blur that fires during a cell→cell navigation can't cancel the move.
	function exitEdit(rowId: string | number, colKey: string) {
		if (isActiveCell(rowId, colKey)) active_cell = null;
	}

	function navigate(dir: 'up' | 'down' | 'left' | 'right' | 'next' | 'prev') {
		if (!active_cell) return;
		const p = navPosition(active_cell);
		if (!p) return;
		let nr = p.row;
		let nc = p.col;
		switch (dir) {
			case 'up':
				nr = Math.max(0, p.row - 1);
				break;
			case 'down':
				nr = Math.min(navRows.length - 1, p.row + 1);
				break;
			case 'left':
				nc = Math.max(0, p.col - 1);
				break;
			case 'right':
				nc = Math.min(p.cols.length - 1, p.col + 1);
				break;
			case 'next':
				if (p.col < p.cols.length - 1) nc = p.col + 1;
				else if (p.row < navRows.length - 1) {
					nr = p.row + 1;
					nc = 0;
				}
				break;
			case 'prev':
				if (p.col > 0) nc = p.col - 1;
				else if (p.row > 0) {
					nr = p.row - 1;
					nc = editableColsFor(navRows[p.row - 1].row).length - 1;
				}
				break;
		}
		const targetRow = navRows[nr];
		if (!targetRow) return;
		const targetCols = editableColsFor(targetRow.row);
		const targetCol = targetCols[Math.min(nc, targetCols.length - 1)];
		if (!targetCol) return;
		const ref = {
			row_id: keyOf(targetRow.row, targetRow.data_index),
			col_key: targetCol.key,
		};
		autoOpenEditorMenu = false; // keyboard advance: focus moves, the menu stays closed
		active_cell = ref;
		roving_cell = ref;
		scrollActiveIntoView(targetRow.visual_index);
		focusActiveCell();
	}

	async function scrollActiveIntoView(visualIndex: number) {
		if (!virtualActive) return;
		await tick();
		const el = tableEl?.querySelector(
			`tbody tr.row[data-row-index="${visualIndex}"]`,
		) as HTMLElement | null;
		el?.scrollIntoView({ block: 'nearest' });
	}

	function findRowById(id: string | number): { row: T; index: number } | null {
		for (let i = 0; i < data.length; i++) {
			if (keyOf(data[i], i) === id) return { row: data[i], index: i };
		}
		return null;
	}

	// Per-keystroke notification (not a commit).
	function liveInput(
		rowId: string | number,
		colKey: string,
		row: T,
		index: number,
		col: Column<T>,
		value: unknown,
	) {
		(col.oninput ?? oncellinput)?.({
			value,
			previous: getCellValue(row, colKey),
			row,
			index,
			column: col,
			key: colKey,
		});
	}

	// Commit a (validated, changed) value: optimistic override + fire onedit, then
	// track pending/saved/error so the display cell can show a spinner / ring / check.
	function applyEdit(
		rowId: string | number,
		colKey: string,
		row: T,
		index: number,
		col: Column<T>,
		next: unknown,
		previous: unknown,
	) {
		const key = cellKey(rowId, colKey);
		cellError = delMap(cellError, key);
		cellOptimistic = setMap(cellOptimistic, key, next);
		const handler = col.onedit ?? oncelledit;
		let result: void | Promise<void>;
		try {
			result = handler?.({ value: next, previous, row, index, column: col, key: colKey });
		} catch (err) {
			handleEditError(key, err);
			return;
		}
		if (result instanceof Promise) {
			cellPending = addSet(cellPending, key);
			result
				.then(() => {
					cellPending = delSet(cellPending, key);
					flashSaved(key);
					clearOptimistic(key);
				})
				.catch((err) => {
					cellPending = delSet(cellPending, key);
					handleEditError(key, err);
				});
		} else {
			flashSaved(key);
			clearOptimistic(key);
		}
	}

	async function clearOptimistic(key: string) {
		// Let the parent's reactive `data` update flush first, so the cell never
		// flickers old → new → old.
		await tick();
		cellOptimistic = delMap(cellOptimistic, key);
	}
	function flashSaved(key: string) {
		cellSaved = addSet(cellSaved, key);
		setTimeout(() => {
			cellSaved = delSet(cellSaved, key);
		}, 1100);
	}
	function handleEditError(key: string, err: unknown) {
		const msg =
			err instanceof Error ? err.message : typeof err === 'string' ? err : 'Save failed';
		cellError = setMap(cellError, key, msg);
		// Keep the optimistic value so the user's input stays visible for a retry.
	}

	// Called by the editor when a changed value is committed.
	function commitCell(
		rowId: string | number,
		colKey: string,
		row: T,
		index: number,
		col: Column<T>,
		next: unknown,
	) {
		const previous = getCellValue(row, colKey);
		if (Object.is(next, previous)) return;
		undoStack.push({ row_id: rowId, col_key: colKey, prev: previous, next });
		if (undoStack.length > 100) undoStack.shift();
		redoStack = [];
		applyEdit(rowId, colKey, row, index, col, next, previous);
	}

	function replayEdit(edit: CellEdit, value: unknown) {
		const key = cellKey(edit.row_id, edit.col_key);
		if (cellPending.has(key)) return false; // serialize per cell — skip while busy
		const found = findRowById(edit.row_id);
		const col = columns.find((c) => c.key === edit.col_key);
		if (!found || !col) return false;
		applyEdit(
			edit.row_id,
			edit.col_key,
			found.row,
			found.index,
			col,
			value,
			getCellValue(found.row, edit.col_key),
		);
		return true;
	}
	function undoEdit() {
		const edit = undoStack[undoStack.length - 1];
		if (!edit) return;
		if (replayEdit(edit, edit.prev)) {
			undoStack.pop();
			redoStack.push(edit);
		}
	}
	function redoEdit() {
		const edit = redoStack[redoStack.length - 1];
		if (!edit) return;
		if (replayEdit(edit, edit.next)) {
			redoStack.pop();
			undoStack.push(edit);
		}
	}
	function tableKeydown(e: KeyboardEvent) {
		if (!editable || !(e.ctrlKey || e.metaKey)) return;
		const k = e.key.toLowerCase();
		if (k === 'z' && !e.shiftKey) {
			e.preventDefault();
			undoEdit();
		} else if ((k === 'z' && e.shiftKey) || k === 'y') {
			e.preventDefault();
			redoEdit();
		}
	}

	// Click into a cell to edit it (and don't let the click toggle row selection /
	// expansion — see the `handleRowClick` guard). Boolean cells are handled by their
	// own always-present button (`toggleBooleanCell`), not here.
	function handleCellClick(e: MouseEvent, rowId: string | number, colKey: string) {
		if (!editable) return;
		const target = e.target as HTMLElement;
		if (target.closest('.resize-handle')) return;
		e.stopPropagation();
		if (!isActiveCell(rowId, colKey)) enterEdit(rowId, colKey);
	}

	// Boolean cells render a persistent button (never swapped for a text editor), so
	// a single click toggles them — focusing-then-mounting an editor would remove the
	// click's target node and the browser would swallow the click.
	function currentCellValue(rowId: string | number, colKey: string, row: T): unknown {
		const key = cellKey(rowId, colKey);
		return cellOptimistic.has(key) ? cellOptimistic.get(key) : getCellValue(row, colKey);
	}
	function toggleBooleanCell(
		rowId: string | number,
		col: Column<T>,
		row: T,
		index: number,
	) {
		if (!isActiveCell(rowId, col.key)) enterEdit(rowId, col.key);
		const cur = !!currentCellValue(rowId, col.key, row);
		commitCell(rowId, col.key, row, index, col, !cur);
	}
	function booleanCellKeydown(
		e: KeyboardEvent,
		rowId: string | number,
		col: Column<T>,
		row: T,
		index: number,
	) {
		if (e.isComposing) return;
		const ref: CellRef = { row_id: rowId, col_key: col.key };
		switch (e.key) {
			case ' ':
				e.preventDefault();
				toggleBooleanCell(rowId, col, row, index);
				break;
			case 'Enter':
				e.preventDefault();
				navigate('down');
				break;
			case 'ArrowUp':
				e.preventDefault();
				navigate('up');
				break;
			case 'ArrowDown':
				e.preventDefault();
				navigate('down');
				break;
			case 'ArrowLeft':
				e.preventDefault();
				navigate('left');
				break;
			case 'ArrowRight':
				e.preventDefault();
				navigate('right');
				break;
			case 'Tab':
				if ((!e.shiftKey && isLastNavCell(ref)) || (e.shiftKey && isFirstNavCell(ref)))
					return;
				e.preventDefault();
				navigate(e.shiftKey ? 'prev' : 'next');
				break;
			case 'Escape':
				e.preventDefault();
				exitEdit(rowId, col.key);
				break;
		}
	}

	// After a keyboard move, focus the active cell's control. Text cells autofocus
	// their editor on mount; boolean buttons need an explicit focus.
	async function focusActiveCell() {
		await tick();
		const el = tableEl?.querySelector(
			'td.cell-active .cell-input, td.cell-active .cell-checkbox',
		) as HTMLElement | null;
		el?.focus();
	}

	// ---- Aria sort ----
	function getAriaSort(col: Column<T>): 'ascending' | 'descending' | 'none' | undefined {
		if (!col.sortable) return undefined;
		if (sort_by !== col.key) return 'none';
		return sort_direction === 'asc' ? 'ascending' : 'descending';
	}

	// ---- Skeleton widths ----
	function getSkeletonWidth(row: number, col: number): string {
		// Deterministic pseudo-random widths
		const seed = ((row + 1) * 7 + (col + 1) * 13) % 100;
		return `${40 + (seed % 45)}%`;
	}

	// ---- Close export menu on outside click ----
	function handleExportBlur(e: FocusEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (!related?.closest('.export')) {
			showExportMenu = false;
		}
	}

	// ======================================================================
	// Reorder (drag-to-reorder rows)
	// ----------------------------------------------------------------------
	// Drag is unified across mouse + touch via Pointer Events. The grabbed
	// row(s) are cloned into a fixed-position overlay that follows the finger
	// (so the drag keeps working even when virtual scrolling unmounts the
	// original row), while the originals stay in the DOM as hidden placeholders
	// to keep the scroll height stable. The other rows shift via `transform` to
	// open a gap at the drop target. The new order is committed to the parent
	// only AFTER the drop animation completes, so the parent re-rendering the
	// list can't interrupt the animation.
	// ======================================================================

	const reorderActive = $derived(
		reorderable && !group_by && !skeleton && !paginationActive && data.length > 0,
	);

	// Tear down any in-flight drag if the table unmounts mid-gesture, so the
	// document-level pointer/key listeners and timers don't leak.
	$effect(() => {
		return () => {
			if (drag?.raf) cancelAnimationFrame(drag.raf);
			if (drag?.hold_timer) clearTimeout(drag.hold_timer);
			if (drag?.settle_timeout) clearTimeout(drag.settle_timeout);
			teardownDragListeners();
		};
	});

	// Pointer Events alone can't keep a touch-drag from scrolling the page — on
	// touch, only `preventDefault()` on a *non-passive* `touchmove` (or
	// `touch-action: none`) blocks the native pan, and the listener has to be
	// attached before the touch starts for the browser to keep `touchmove`
	// cancelable. So we mount it on the wrapper for as long as the table is
	// reorderable rather than per-gesture. Touch events stay bound to their start
	// target, so this still receives every move of a drag that wanders off the
	// table. It only swallows the event once a long-press has armed the drag (or
	// the drag is already running), leaving ordinary scroll-by-drag untouched.
	$effect(() => {
		const el = wrapperEl;
		if (!el || !reorderActive) return;
		el.addEventListener('touchmove', onDragTouchMove, { passive: false });
		el.addEventListener('contextmenu', onDragContextMenu);
		return () => {
			el.removeEventListener('touchmove', onDragTouchMove);
			el.removeEventListener('contextmenu', onDragContextMenu);
		};
	});
	function onDragTouchMove(e: TouchEvent) {
		if ((drag?.armed || reorderDragging) && e.cancelable) e.preventDefault();
	}
	// Android fires `contextmenu` on a long-press (`-webkit-touch-callout` only
	// covers iOS), which would interrupt the hold-to-drag. Swallow it only while a
	// reorder gesture is live: a normal right-click never creates `drag` (it's
	// gated to the primary button in `onRowPointerDown`), so desktop context menus
	// elsewhere are unaffected.
	function onDragContextMenu(e: Event) {
		if (drag) e.preventDefault();
	}

	// ---- Geometry helpers (content space: body top = 0, scroll-independent) ----
	function headerHeightPx(): number {
		const head = tableEl?.querySelector('thead tr') as HTMLElement | null;
		return head ? head.getBoundingClientRect().height : 0;
	}
	function bodyTopClient(): number {
		if (!tableEl) return 0;
		// table box top scrolls with content; the header track sits on top of it.
		return tableEl.getBoundingClientRect().top + headerHeightPx();
	}
	function contentY(clientY: number): number {
		return clientY - bodyTopClient();
	}

	// ---- Which element scrolls for edge auto-scroll ----
	function nearestScrollable(el: HTMLElement | null): HTMLElement | null {
		let node = el?.parentElement ?? null;
		while (node) {
			const s = getComputedStyle(node);
			if (/(auto|scroll)/.test(s.overflowY) && node.scrollHeight > node.clientHeight) {
				return node;
			}
			node = node.parentElement;
		}
		return null;
	}
	function reorderScrollTarget(): HTMLElement | Window {
		if (containerScroll && scrollEl) return scrollEl;
		if (virtualActive && resolvedScroller) return resolvedScroller;
		return nearestScrollable(wrapperEl) ?? window;
	}
	function applyAutoScroll(clientY: number) {
		const t = reorderScrollTarget();
		let top: number, bottom: number;
		if (t instanceof Window) {
			top = 0;
			bottom = window.innerHeight;
		} else {
			const r = t.getBoundingClientRect();
			top = r.top;
			bottom = r.bottom;
		}
		let speed = 0;
		if (clientY < top + EDGE_SIZE) {
			speed = -MAX_SCROLL_SPEED * clamp((top + EDGE_SIZE - clientY) / EDGE_SIZE, 0, 1);
		} else if (clientY > bottom - EDGE_SIZE) {
			speed =
				MAX_SCROLL_SPEED * clamp((clientY - (bottom - EDGE_SIZE)) / EDGE_SIZE, 0, 1);
		}
		if (!speed) return;
		if (t instanceof Window) window.scrollBy(0, speed);
		else t.scrollTop += speed;
	}

	// ---- Pointer down on a row ----
	function onRowPointerDown(e: PointerEvent, dataIndex: number, visualIndex: number) {
		if (!reorderActive || drag) return;
		// Mouse: primary button only. Touch/pen: proceed.
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const target = e.target as HTMLElement;
		// Let interactive controls (and the row's own checkbox/expand toggles) win.
		if (
			target.closest(
				'a, button, input, select, textarea, label, [data-no-drag], .check-wrap, .expand-btn, .resize-handle',
			)
		) {
			return;
		}

		suppressNextClick = false;

		// Drag the whole selection when grabbing a selected row in a multi-select;
		// otherwise just the grabbed row.
		let draggedVis: number[];
		if (selectable && isSelectedIndex(dataIndex) && selectedIndexSet.size > 1) {
			draggedVis = flatRows
				.filter((f) => selectedIndexSet.has(f.data_index))
				.map((f) => f.visual_index)
				.sort((a, b) => a - b);
		} else {
			draggedVis = [visualIndex];
		}

		// Measure the row itself — the gesture may have started on the grip cell
		// (editable + reorderable) rather than the whole <tr>.
		const grabbedEl =
			(e.currentTarget as HTMLElement).closest('tr.row') ??
			(e.currentTarget as HTMLElement);
		const grabbedRect = grabbedEl.getBoundingClientRect();
		const draggedRows = draggedVis.map((vi) => flatRows[vi].row);

		drag = {
			pointer_id: e.pointerId,
			pointer_type: e.pointerType,
			start_client_x: e.clientX,
			start_client_y: e.clientY,
			last_client_x: e.clientX,
			last_client_y: e.clientY,
			grab_vi: visualIndex,
			grab_row_top: grabbedRect.top,
			grab_within_block: 0,
			grab_row_offset_in_block: 0,
			overlay_grab_offset: 0,
			overlay_top_content_offset: 0,
			collapsed: false,
			dragged_vis: draggedVis,
			dragged_set: new Set(draggedVis),
			dragged_rows: draggedRows,
			dragged_row_set: new Set(draggedRows),
			virtual: virtualActive,
			rh: effectiveRowHeight,
			total: flatRows.length,
			block_height: 0,
			top_by_vi: [],
			h_by_vi: [],
			removed_above: [],
			r_rank: [],
			r_vis: [],
			insert_at: 0,
			last_insert_at: -1,
			block_top_content: 0,
			prev_center: null,
			move_dir: 1,
			armed: false,
			hold_timer: null,
			raf: null,
			settling: false,
			settle_timeout: null,
		};

		document.addEventListener('pointermove', onDragPointerMove, { passive: false });
		document.addEventListener('pointerup', onDragPointerUp);
		document.addEventListener('pointercancel', onDragPointerCancel);
		window.addEventListener('keydown', onDragKeydown);

		if (e.pointerType === 'mouse') {
			drag.armed = true; // desktop: ready to drag at once (threshold gates it)
		} else {
			// Touch/pen: require a held long-press so scrolling still works.
			drag.hold_timer = window.setTimeout(() => armTouchDrag(dataIndex), HOLD_DELAY);
		}
	}

	function armTouchDrag(dataIndex: number) {
		if (!drag) return;
		drag.armed = true;
		drag.hold_timer = null;
		armedDataIndex = dataIndex; // shows the "ready to move" lift
		if (typeof navigator !== 'undefined') navigator.vibrate?.(12);
	}

	function onDragPointerMove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointer_id) return;
		drag.last_client_x = e.clientX;
		drag.last_client_y = e.clientY;
		const dist = Math.hypot(
			e.clientX - drag.start_client_x,
			e.clientY - drag.start_client_y,
		);

		if (!drag.armed) {
			// Touch, pre-arm: real movement means the user is scrolling — bail and
			// let the browser scroll (we never called preventDefault).
			if (dist > SCROLL_TOLERANCE) cancelPendingDrag();
			return;
		}

		if (!reorderDragging) {
			// Mouse needs a small threshold so a plain click still selects; a held
			// touch drag starts on the first move.
			if (drag.pointer_type === 'mouse' && dist < DRAG_THRESHOLD) return;
			startDrag();
		}

		if (reorderDragging) {
			// Non-passive listener: take over the gesture so the page can't scroll.
			e.preventDefault();
		}
	}

	function startDrag() {
		if (!drag) return;
		if (drag.hold_timer) {
			clearTimeout(drag.hold_timer);
			drag.hold_timer = null;
		}
		armedDataIndex = null;
		reorderDragging = true;
		suppressNextClick = true;

		// Land `.reordering` in the DOM *before* we measure: it triggers the press
		// suppressor (.wrapper.reordering .row.clickable:active), so the grabbed row
		// is measured at its true height, not the scaled-down :active press height.
		// Otherwise the gap opens by a too-short block and every shifted row snaps
		// ~1px on drop, accumulating with drag distance.
		flushSync();

		buildDragLayout();

		// Hide the originals.
		draggedDataSet = new Set(drag.dragged_rows.map((r) => rowIndexMap.get(r) as number));

		// Build the floating overlay. Many rows collapse to just the grabbed row
		// plus a "+N" badge so the drag stays compact (the gap still reserves the
		// full block, so the commit doesn't jump). The overlay then tracks and
		// settles on the GRABBED row's slot, not the whole block's top.
		const withinRow = drag.start_client_y - drag.grab_row_top;
		if (drag.dragged_vis.length >= REORDER_COLLAPSE_AT) {
			drag.collapsed = true;
			const g = flatRows[drag.grab_vi];
			overlayRows = [{ row: g.row, data_index: g.data_index }];
			overlayMore = drag.dragged_vis.length;
			drag.overlay_grab_offset = withinRow;
			drag.overlay_top_content_offset = drag.grab_row_offset_in_block;
		} else {
			drag.collapsed = false;
			overlayRows = drag.dragged_vis.map((vi) => ({
				row: flatRows[vi].row,
				data_index: flatRows[vi].data_index,
			}));
			overlayMore = 0;
			drag.overlay_grab_offset = drag.grab_within_block;
			drag.overlay_top_content_offset = 0;
		}

		updateInsertAt();
		// applyNeighborTransforms();
		// Position + lift the overlay once it's mounted, before the first paint.
		tick().then(liftInOverlay);
		drag.raf = requestAnimationFrame(dragFrame);

		onreorderstart?.({ from: drag.dragged_vis.map((vi) => flatRows[vi].data_index) });
	}

	// Snapshot the layout needed to compute the gap. Virtual mode is uniform
	// (measured row height); normal mode measures every rendered row.
	function buildDragLayout() {
		if (!drag) return;
		const rh = drag.rh;
		if (drag.virtual) {
			drag.block_height = drag.dragged_vis.length * rh;
			// grab offset within the block (uniform heights)
			let off = 0;
			for (const vi of drag.dragged_vis) {
				if (vi === drag.grab_vi) break;
				off += rh;
			}
			drag.grab_row_offset_in_block = off;
			drag.grab_within_block = off + (drag.start_client_y - drag.grab_row_top);
			return;
		}

		const els = tableEl?.querySelectorAll('tbody tr.row') ?? [];
		const topByVi: number[] = [];
		const hByVi: number[] = [];
		els.forEach((el) => {
			const vi = Number((el as HTMLElement).dataset.rowIndex);
			if (Number.isNaN(vi)) return;
			const r = el.getBoundingClientRect();
			topByVi[vi] = contentY(r.top);
			hByVi[vi] = r.height;
		});

		// `tr.row:last-child` drops its border-bottom (a 1px overshoot would force a
		// phantom scrollbar — see the divider rules in the stylesheet), so the final
		// row measures ~1px shorter than every other row. The reorder treats heights as
		// position-independent, so without this the bordered row that ENDS UP last
		// after a drop lands 1px off — most visible dragging the top row to the very
		// bottom. Normalise the last row back to the shared "with divider" height.
		const lastEl = els[els.length - 1] as HTMLElement | undefined;
		const firstEl = els[0] as HTMLElement | undefined;
		if (lastEl && firstEl && lastEl !== firstEl) {
			const lastVi = Number(lastEl.dataset.rowIndex);
			const lastBorder = parseFloat(getComputedStyle(lastEl).borderBottomWidth) || 0;
			if (!Number.isNaN(lastVi) && lastBorder === 0) {
				hByVi[lastVi] += parseFloat(getComputedStyle(firstEl).borderBottomWidth) || 0;
			}
		}

		// Grab offset within the (assembled) block, using measured heights.
		let off = 0;
		for (const vi of drag.dragged_vis) {
			if (vi === drag.grab_vi) break;
			off += hByVi[vi] ?? rh;
		}
		drag.grab_row_offset_in_block = off;
		drag.grab_within_block = off + (drag.start_client_y - drag.grab_row_top);

		// Single pass: running dragged-height-removed and non-dragged rank.
		const removedAbove: number[] = [];
		const rRank: number[] = [];
		const rVis: number[] = [];
		let removed = 0;
		let rank = 0;
		let blockH = 0;
		for (let vi = 0; vi < drag.total; vi++) {
			removedAbove[vi] = removed;
			rRank[vi] = rank;
			if (drag.dragged_set.has(vi)) {
				removed += hByVi[vi] ?? rh;
				blockH += hByVi[vi] ?? rh;
			} else {
				rVis.push(vi);
				rank++;
			}
		}
		drag.top_by_vi = topByVi;
		drag.h_by_vi = hByVi;
		drag.removed_above = removedAbove;
		drag.r_rank = rRank;
		drag.r_vis = rVis;
		drag.block_height = blockH;
	}

	function draggedBefore(vi: number): number {
		if (!drag) return 0;
		let n = 0;
		for (const dv of drag.dragged_vis) {
			if (dv < vi) n++;
			else break;
		}
		return n;
	}

	// Where (in non-dragged "R" space) the block should be inserted. The anchor is
	// the GRABBED row's centre (not the raw pointer, and independent of where
	// within the row you grabbed). The gap moves past a neighbour once that centre
	// crosses the neighbour's *near* edge in the direction of travel — its TOP when
	// moving down, its BOTTOM when moving up — so the trigger is a symmetric ~50%
	// overlap in both directions. Direction is sticky (hysteresis) so the gap
	// doesn't jump when the pointer pauses.
	function updateInsertAt() {
		if (!drag) return;
		const withinRow = drag.start_client_y - drag.grab_row_top;
		const grabbedH = drag.virtual ? drag.rh : (drag.h_by_vi[drag.grab_vi] ?? drag.rh);
		const grabbedCenter = contentY(drag.last_client_y) - withinRow + grabbedH / 2;

		const delta = grabbedCenter - (drag.prev_center ?? grabbedCenter);
		if (delta > 0.5) drag.move_dir = 1;
		else if (delta < -0.5) drag.move_dir = -1;
		drag.prev_center = grabbedCenter;
		const down = drag.move_dir === 1;

		let insertAt: number;
		if (drag.virtual) {
			const rh = drag.rh;
			// Down: count rows whose top is above the centre. Up: whose bottom is.
			// (epsilon stabilises the exact-boundary case against float jitter.)
			const rawSlot = down
				? clamp(Math.ceil(grabbedCenter / rh - 1e-4), 0, drag.total)
				: clamp(Math.floor(grabbedCenter / rh - 1e-4), 0, drag.total);
			insertAt = clamp(
				rawSlot - draggedBefore(rawSlot),
				0,
				drag.total - drag.dragged_vis.length,
			);
		} else {
			let count = 0;
			for (const vi of drag.r_vis) {
				const edge = down ? drag.top_by_vi[vi] : drag.top_by_vi[vi] + drag.h_by_vi[vi];
				if (edge < grabbedCenter) count++;
				else break;
			}
			insertAt = clamp(count, 0, drag.r_vis.length);
		}
		drag.insert_at = insertAt;
	}

	// Shift the non-dragged rows to open the gap; also records where the block
	// will land (block_top_content) for the drop animation.
	function applyNeighborTransforms() {
		if (!drag) return;
		const insertAt = drag.insert_at;
		const blockH = drag.block_height;
		const m = new Map<number, number>();

		if (drag.virtual) {
			const rh = drag.rh;
			const win = virtualWindow;
			if (win) {
				for (const rr of win.rows) {
					if (drag.dragged_set.has(rr.visual_index)) continue;
					const vi = rr.visual_index;
					const rR = vi - draggedBefore(vi);
					const targetTop = rR * rh + (rR >= insertAt ? blockH : 0);
					m.set(rr.data_index, targetTop - vi * rh);
				}
			}
			drag.block_top_content = insertAt * rh;
		} else {
			for (const vi of drag.r_vis) {
				const inserted = drag.r_rank[vi] >= insertAt ? blockH : 0;
				m.set(flatRows[vi].data_index, inserted - drag.removed_above[vi]);
			}
			// The block lands at the (closed-up) top of the row now at insertAt, or
			// just past the last row when inserting at the very end.
			const rv = drag.r_vis;
			if (rv.length === 0) {
				drag.block_top_content = 0;
			} else if (insertAt < rv.length) {
				const vi = rv[insertAt];
				drag.block_top_content = drag.top_by_vi[vi] - drag.removed_above[vi];
			} else {
				const vi = rv[rv.length - 1];
				drag.block_top_content =
					drag.top_by_vi[vi] - drag.removed_above[vi] + drag.h_by_vi[vi];
			}
		}
		rowTransforms = m;
	}

	function positionOverlay() {
		if (!drag || !overlayEl || !tableEl) return;
		const y = drag.last_client_y - drag.overlay_grab_offset;
		const tr = tableEl.getBoundingClientRect();
		overlayEl.style.width = `${tableEl.scrollWidth}px`;
		// Position via `translate` and lift via `scale` as separate properties: the
		// per-frame pointer-follow (translate) stays instant while `scale` carries
		// its own transition (the lift-in here and the drop-settle in finishDrop).
		// Scale is centred on the card, so the lift grows symmetrically instead of
		// shifting sideways by the translate offset.
		overlayEl.style.translate = `${tr.left}px ${y}px`;
		overlayEl.style.scale = `${LIFT_SCALE}`;
	}

	// First paint of the overlay: pin it at the grabbed row's pressed scale and ease
	// up to the lift, so the float grows out of the :active push rather than snapping
	// to full size. Only `scale` transitions — `translate` keeps tracking the pointer
	// with no lag because it's not in the transition list.
	function liftInOverlay() {
		if (!drag || !overlayEl) return;
		// Two-value scale mirrors the row's :active press (x fixed-pixel, y ratio);
		// it interpolates cleanly to the single-value LIFT_SCALE.
		const start =
			drag.pointer_type === 'mouse'
				? `${pressScaleFor(scrollEl?.clientWidth ?? 0)} ${PRESS_SCALE_Y}`
				: '1';
		positionOverlay();
		overlayEl.style.transition = 'none';
		overlayEl.style.scale = `${start}`;
		void overlayEl.offsetWidth; // commit the compressed start frame
		overlayEl.style.transition = `scale ${LIFT_IN_MS}ms ${LIFT_IN_EASE}`;
		overlayEl.style.scale = `${LIFT_SCALE}`;
	}

	// rAF loop: auto-scroll near the edges, keep the overlay under the finger,
	// and recompute the gap (the pointer may be stationary while auto-scrolling).
	function dragFrame() {
		if (!drag || !reorderDragging) return;
		applyAutoScroll(drag.last_client_y);
		positionOverlay();
		updateInsertAt();
		// Virtual: the rendered window changes as we auto-scroll, so refresh every
		// frame. Normal: only when the target actually moves.
		if (drag.virtual) {
			applyNeighborTransforms();
		} else if (drag.insert_at !== drag.last_insert_at) {
			applyNeighborTransforms();
			drag.last_insert_at = drag.insert_at;
		}
		drag.raf = requestAnimationFrame(dragFrame);
	}

	function onDragPointerUp(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointer_id) return;
		if (reorderDragging) finishDrop(false);
		else cancelPendingDrag();
	}

	function onDragPointerCancel(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointer_id) return;
		if (reorderDragging)
			finishDrop(true); // abort: animate home, don't commit
		else cancelPendingDrag();
	}

	function onDragKeydown(e: KeyboardEvent) {
		if (!drag || e.key !== 'Escape') return;
		if (reorderDragging) finishDrop(true);
		else cancelPendingDrag();
	}

	// A press that never became a drag (a click, or a touch that turned into a
	// scroll): tear everything down and let the normal click handler run.
	function cancelPendingDrag() {
		if (!drag) return;
		if (drag.hold_timer) clearTimeout(drag.hold_timer);
		if (drag.raf) cancelAnimationFrame(drag.raf);
		teardownDragListeners();
		armedDataIndex = null;
		drag = null;
	}

	function teardownDragListeners() {
		document.removeEventListener('pointermove', onDragPointerMove);
		document.removeEventListener('pointerup', onDragPointerUp);
		document.removeEventListener('pointercancel', onDragPointerCancel);
		window.removeEventListener('keydown', onDragKeydown);
	}

	function sameSeq(a: T[], b: T[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
		return true;
	}

	// Insertion index that leaves the order unchanged (block's original home).
	function homeInsertAt(): number {
		if (!drag) return 0;
		const first = drag.dragged_vis[0];
		let c = 0;
		for (let vi = 0; vi < first; vi++) if (!drag.dragged_set.has(vi)) c++;
		return c;
	}

	// Pointer released (or aborted): freeze the final target, animate the overlay
	// into the gap, and only THEN commit the new order to the parent.
	function finishDrop(abort: boolean) {
		if (!drag || drag.settling) return;
		if (drag.raf) {
			cancelAnimationFrame(drag.raf);
			drag.raf = null;
		}
		// No more pointer/key input drives the drag once it's settling; the drop
		// completes via the overlay's transitionend (or the fallback timeout).
		teardownDragListeners();

		updateInsertAt();
		if (abort) drag.insert_at = homeInsertAt();
		applyNeighborTransforms();

		const from = drag.dragged_vis.map((vi) => flatRows[vi].data_index);
		const insertAt = drag.insert_at;
		const oldVisual = flatRows.map((f) => f.row);
		const dset = drag.dragged_row_set;
		const draggedRows = drag.dragged_rows;
		const rRows = oldVisual.filter((r) => !dset.has(r));
		const newData = abort
			? data
			: [...rRows.slice(0, insertAt), ...draggedRows, ...rRows.slice(insertAt)];
		const changed = !abort && !sameSeq(newData, oldVisual);

		reorderDragging = false;
		reorderDropping = true;
		drag.settling = true;
		if (!abort) ondrop?.({ from, to: insertAt });

		// Animate the overlay to the gap's current on-screen position, easing the
		// lift scale back to 1. A collapsed overlay lands on the grabbed row's slot
		// within the block, not the top.
		const targetY =
			bodyTopClient() + drag.block_top_content + drag.overlay_top_content_offset;
		const left = tableEl ? tableEl.getBoundingClientRect().left : 0;
		const done = () => finishSettle(changed, from, insertAt, newData);
		if (overlayEl) {
			overlayEl.classList.add('settling');
			overlayEl.style.transition = `translate ${SETTLE_MS}ms ${SETTLE_EASE}, scale ${SETTLE_MS}ms ${SETTLE_EASE}, filter ${SETTLE_MS}ms ease`;
			overlayEl.style.translate = `${left}px ${targetY}px`;
			overlayEl.style.scale = '1';
			overlayEl.addEventListener('transitionend', done, { once: true });
		}
		// Fallback (reduced motion / no movement = no transitionend).
		drag.settle_timeout = window.setTimeout(done, SETTLE_MS + 80);
	}

	// Drop animation finished: reset all visual state and commit in the SAME
	// synchronous tick so Svelte flushes once — the rows re-render in their new
	// order with no transforms, so nothing visibly jumps.
	function finishSettle(changed: boolean, from: number[], to: number, newData: T[]) {
		if (!drag) return;
		if (drag.settle_timeout) clearTimeout(drag.settle_timeout);
		teardownDragListeners();

		const oldData = data;

		// Reset visuals.
		reorderDropping = false;
		draggedDataSet = new Set();
		rowTransforms = new Map();
		overlayRows = [];
		armedDataIndex = null;
		drag = null;

		if (changed) onreorder?.({ from, to, oldData, newData });
		// Drop any straggler click and release the suppressor on the next tick, so a
		// completed drag never toggles selection on the trailing pointerup/click.
		setTimeout(() => (suppressNextClick = false), 0);
	}
</script>

<div
	bind:this={wrapperEl}
	class={['wrapper', class_name].filter(Boolean).join(' ')}
	class:dense
	class:comfortable
	class:striped
	class:reordering={reorderDragging || reorderDropping}
	class:resizing-active={!!resizing}
	{id}>
	{#if showPager && (pgConfig.position === 'top' || pgConfig.position === 'both')}
		{@render pager('top')}
	{/if}
	{#if exportable}
		<div class="toolbar">
			<div class="export" onfocusout={handleExportBlur}>
				<button
					type="button"
					aria-haspopup="true"
					aria-expanded={showExportMenu}
					onclick={() => (showExportMenu = !showExportMenu)}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M8 2v8M8 10L5 7M8 10l3-3M3 12h10"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
					Export
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
						<path
							d="M3 5l3 3 3-3"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
				</button>
				{#if showExportMenu}
					<div class="menu" role="menu">
						<button type="button" role="menuitem" onclick={exportCSV}>Export CSV</button>
						<button type="button" role="menuitem" onclick={exportJSON}>
							Export JSON
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="scroll"
		class:bounded={containerScroll}
		class:passthrough={virtualActive && !containerScroll}
		style:max-height={resolvedMaxHeight}
		bind:this={scrollEl}
		{@attach scrollbar({
			// With a sticky header the scrollable region visually starts below it,
			// so pin the track top to the header's bottom edge instead of the radius
			track_insets: (el) => ({
				top: el.querySelector<HTMLElement>('thead tr.sticky')?.offsetHeight,
			}),
		})}
		onmouseleave={() => {
			hoverIndex = null;
			hoveredResizeKey = null;
		}}>
		<!-- onmouseover only drives the visual resize-border hover preview; keyboard
		     users resize via the focusable header separators, so no focus pairing. -->
		<!-- svelte-ignore a11y_mouse_events_have_key_events -->
		<table
			role="grid"
			class:editable
			bind:this={tableEl}
			onmouseover={resizable ? onResizeHover : undefined}
			onkeydown={editable ? tableKeydown : undefined}
			style:grid-template-columns={gridTemplateColumns}>
			<!-- The CSS `display` override (grid/subgrid) strips the implicit ARIA
			     roles of the native table elements, so they are restored explicitly.
			     Svelte's a11y_no_redundant_roles check can't see the CSS, hence the
			     ignores below. -->
			<thead>
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<tr role="row" class:sticky={sticky_header}>
					{#if reorderGrip}
						<th class="grip-cell" role="columnheader" aria-label="Reorder"></th>
					{/if}
					{#if selectable}
						<th class="checkbox-cell" role="columnheader">
							<div
								class="check-wrap"
								class:checked={allSelected}
								class:indeterminate={someSelected}
								role="checkbox"
								tabindex="0"
								aria-checked={someSelected ? 'mixed' : allSelected}
								aria-label="Select all rows"
								{@attach ripple({ centered: true, opacity: 0.15 })}
								onclick={toggleSelectAll}
								onkeydown={handleSelectAllKeydown}>
								{@render checkIndicator(allSelected, someSelected, false)}
							</div>
						</th>
					{/if}
					{#if expandable}
						<th class="expand-cell" role="columnheader"></th>
					{/if}
					{#each columns as col, ci (col.key)}
						<th
							style={getColumnStyle(col)}
							data-col-key={col.key}
							role="columnheader"
							aria-sort={getAriaSort(col)}
							class:sortable={col.sortable && !col.header}
							class:col-resizing={resizing?.column_key === col.key}
							class:col-hover={hoveredResizeKey === col.key}>
							{#if col.header}
								<div class="th-content">
									{@render col.header({ column: col })}
								</div>
							{:else if col.sortable}
								<button
									class="th-button"
									type="button"
									style:justify-content={headerJustify(col)}
									onclick={() => handleSort(col.key)}
									{@attach ripple({ opacity: 0.12 })}>
									<span>{col.label}</span>
									<span class="sort-icon" class:active={sort_by === col.key}>
										{#if sort_by === col.key}
											<span class="arrow-rot" class:desc={sort_direction === 'desc'}>
												<svg
													class="arrow"
													width="17"
													height="17"
													viewBox="0 0 20 20"
													fill="none"
													aria-hidden="true">
													<path
														d="M10 15.5V5M5.5 9.5L10 5l4.5 4.5"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round" />
												</svg>
											</span>
										{:else}
											<svg
												class="arrow-hint"
												width="17"
												height="17"
												viewBox="0 0 20 20"
												fill="none"
												aria-hidden="true">
												<path
													d="M6.5 8L10 4.5L13.5 8M6.5 12L10 15.5L13.5 12"
													stroke="currentColor"
													stroke-width="1.75"
													stroke-linecap="round"
													stroke-linejoin="round" />
											</svg>
										{/if}
									</span>
								</button>
							{:else}
								<div class="th-content" style:justify-content={headerJustify(col)}>
									<span>{col.label}</span>
								</div>
							{/if}
							{#if resizable}
								<!-- A focusable, resizable separator (the WAI-ARIA window-splitter
								     pattern): the tabindex + key/pointer handlers are intentional. -->
								<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
								<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
								<span
									class="resize-handle"
									class:active={resizing?.column_key === col.key}
									class:edge={ci === columns.length - 1}
									role="separator"
									aria-orientation="vertical"
									aria-label="Resize {col.label} column"
									tabindex="0"
									data-resize-key={col.key}
									title="Drag to resize · double-click to auto-fit"
									onpointerdown={(e) => startResize(e, col.key)}
									ondblclick={(e) => autoFitColumn(e, col.key)}
									onkeydown={(e) => handleResizeKeydown(e, col.key)}>
									<span class="resize-line" aria-hidden="true"></span>
								</span>
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if skeleton}
					{#each { length: skeleton_count } as _, ri}
						<!-- --shimmer-delay inherits to every bar's animating ::after,
						     staggering the shimmer into a wave down the rows. -->
						<tr
							class="skeleton-row"
							aria-hidden="true"
							style:--shimmer-delay="{ri * 120}ms">
							{#if selectable}
								<td class="checkbox-cell">
									<div
										class="skeleton-bar glyph"
										style="width: 18px; height: 18px; border-radius: 5px;">
									</div>
								</td>
							{/if}
							{#if expandable}
								<td class="expand-cell">
									<div
										class="skeleton-bar glyph"
										style="width: 18px; height: 18px; border-radius: 50%;">
									</div>
								</td>
							{/if}
							{#each columns as col, ci (col.key)}
								<td style={col.align ? `text-align: ${col.align}` : ''}>
									<div class="skeleton-bar" style="width: {getSkeletonWidth(ri, ci)}">
									</div>
								</td>
							{/each}
						</tr>
					{/each}
				{:else if data.length === 0}
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<tr class="empty-row" role="row">
						<td colspan={totalColumns} role="gridcell">
							{#if empty}
								{@render empty()}
							{:else}
								<div class="empty">
									<svg
										width="48"
										height="48"
										viewBox="0 0 48 48"
										fill="none"
										aria-hidden="true">
										<rect
											x="6"
											y="10"
											width="36"
											height="28"
											rx="4"
											stroke="currentColor"
											stroke-width="2"
											fill="none"
											opacity="0.3" />
										<line
											x1="6"
											y1="18"
											x2="42"
											y2="18"
											stroke="currentColor"
											stroke-width="2"
											opacity="0.3" />
										<line
											x1="18"
											y1="18"
											x2="18"
											y2="38"
											stroke="currentColor"
											stroke-width="2"
											opacity="0.2" />
									</svg>
									<p>No data available</p>
								</div>
							{/if}
						</td>
					</tr>
				{:else if groupedData}
					{#each groupedData as group (group.key)}
						<!-- svelte-ignore a11y_no_redundant_roles -->
						<tr class="group-row" role="row">
							<td colspan={totalColumns} role="gridcell">
								<button
									class="group-toggle"
									type="button"
									onclick={() => toggleGroup(group.key)}
									aria-expanded={!collapsedGroups.has(group.key)}>
									<svg
										class="group-chevron"
										class:group-collapsed={collapsedGroups.has(group.key)}
										width="14"
										height="14"
										viewBox="0 0 14 14"
										fill="none"
										aria-hidden="true">
										<path
											d="M5 3l4 4-4 4"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round" />
									</svg>
									<span class="group-label">{group.label}</span>
									<span class="group-count">({group.rows.length})</span>
								</button>
							</td>
						</tr>
						{#if !collapsedGroups.has(group.key)}
							{#each group.rows as { row, data_index, visual_index } (keyOf(row, data_index))}
								{@render dataRow(row, data_index, visual_index)}
								{#if expandable && expandedRows.has(data_index) && expanded_row}
									{@render expandedRowTr(row, data_index)}
								{/if}
							{/each}
						{/if}
					{/each}
				{:else if virtualWindow}
					{#if virtualWindow.top_pad > 0}
						<tr
							class="v-spacer"
							aria-hidden="true"
							style:height="{virtualWindow.top_pad}px">
						</tr>
					{/if}
					{#each virtualWindow.rows as { row, data_index, visual_index } (keyOf(row, data_index))}
						{@render dataRow(row, data_index, visual_index)}
						{#if expandable && expandedRows.has(data_index) && expanded_row}
							{@render expandedRowTr(row, data_index)}
						{/if}
					{/each}
					{#if virtualWindow.bottom_pad > 0}
						<tr
							class="v-spacer"
							aria-hidden="true"
							style:height="{virtualWindow.bottom_pad}px">
						</tr>
					{/if}
				{:else}
					{#each flatRows as { row, data_index, visual_index } (keyOf(row, data_index))}
						{@render dataRow(row, data_index, visual_index)}
						{#if expandable && expandedRows.has(data_index) && expanded_row}
							{@render expandedRowTr(row, data_index)}
						{/if}
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Floating drag overlay: the lifted row(s), cloned, following the pointer.
	     Position is driven imperatively (see positionOverlay/finishDrop). Lives
	     outside `.scroll` so it isn't clipped, and is purely presentational. -->
	{#if reorderDragging || reorderDropping}
		<div
			bind:this={overlayEl}
			class="drag-overlay"
			class:dense
			class:comfortable
			class:collapsed={overlayMore > 0}
			style:grid-template-columns={gridTemplateColumns}
			aria-hidden="true">
			{#each overlayRows as { row, data_index } (data_index)}
				<div class="ghost-row">
					{#if reorderGrip}
						<div class="ghost-cell grip-cell">
							<svg
								class="grip-dots"
								viewBox="0 0 10 16"
								width="10"
								height="16"
								aria-hidden="true">
								<circle cx="2.5" cy="3" r="1.2" />
								<circle cx="7.5" cy="3" r="1.2" />
								<circle cx="2.5" cy="8" r="1.2" />
								<circle cx="7.5" cy="8" r="1.2" />
								<circle cx="2.5" cy="13" r="1.2" />
								<circle cx="7.5" cy="13" r="1.2" />
							</svg>
						</div>
					{/if}
					{#if selectable}
						<div class="ghost-cell checkbox-cell">
							<span class="check-wrap" class:checked={isSelectedIndex(data_index)}>
								{@render checkIndicator(isSelectedIndex(data_index), false, false)}
							</span>
						</div>
					{/if}
					{#if expandable}
						<div class="ghost-cell expand-cell"><span class="expand-btn"></span></div>
					{/if}
					{#each columns as col (col.key)}
						<div class="ghost-cell" style={getColumnStyle(col)}>
							{#if col.cell}
								{@render col.cell({
									value: getCellValue(row, col.key),
									row,
									index: data_index,
								})}
							{:else}
								<span class="cell-text">{getCellValue(row, col.key) ?? ''}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
			{#if overlayMore > 0}
				<div class="drag-count" aria-hidden="true">{overlayMore}</div>
			{/if}
		</div>
	{/if}

	{#if showPager && (pgConfig.position === 'bottom' || pgConfig.position === 'both')}
		{@render pager('bottom')}
	{/if}
</div>

{#snippet pager(placement: 'top' | 'bottom')}
	<div class="pager align-{pgConfig.align}" class:top={placement === 'top'}>
		<Pagination
			bind:page
			bind:page_size
			total_pages={pgTotalPages}
			total_items={pgTotalItems}
			page_size_options={pgConfig.page_size_options ?? [10, 25, 50, 100]}
			simple={pgConfig.variant === 'simple'}
			compact={pgConfig.variant === 'compact'}
			show_page_size={!!pgConfig.page_size_options}
			show_info={pgConfig.show_info}
			sibling_count={pgConfig.sibling_count}
			boundary_count={pgConfig.boundary_count}
			size={pgConfig.size}
			onchange={(d) => onpagechange?.({ page: d.page, page_size })} />
	</div>
{/snippet}

{#snippet checkIndicator(checked: boolean, indeterminate: boolean, preview: boolean)}
	<svg
		class="check-icon"
		class:checked={checked || indeterminate}
		class:indeterminate
		class:preview
		viewBox="0 0 24 24"
		width="20"
		height="20"
		fill="none"
		aria-hidden="true">
		<rect class="box" x="2" y="2" width="20" height="20" rx="5" stroke-width="2" />
		{#if indeterminate}
			<line
				class="dash"
				x1="7"
				y1="12"
				x2="17"
				y2="12"
				stroke-width="2.5"
				stroke-linecap="round" />
		{:else}
			<path
				class="check"
				d="M6 12.5 L10 16.5 L18 8"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round" />
		{/if}
	</svg>
{/snippet}

{#snippet dataRow(row: T, dataIndex: number, visualIndex: number)}
	{@const rowClickable = selectable || !!onrowclick || expandable}
	{@const rowSelected = selectable && isSelectedIndex(dataIndex)}
	{@const previewing = selectable && isPreviewingVisual(visualIndex) && !rowSelected}
	{@const dragShift = rowTransforms.get(dataIndex)}
	<!-- svelte-ignore a11y_no_redundant_roles -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<tr
		role="row"
		class="row"
		data-row-index={visualIndex}
		class:stripe={striped && visualIndex % 2 === 1}
		class:selected={rowSelected}
		class:preview={previewing}
		class:clickable={rowClickable}
		class:reorderable={reorderActive}
		class:drag-source={draggedDataSet.has(dataIndex)}
		class:drag-armed={armedDataIndex === dataIndex}
		style:transform={dragShift ? `translateY(${dragShift}px)` : undefined}
		onclick={(e) => handleRowClick(row, dataIndex, visualIndex, e)}
		onmouseenter={() => {
			if (selectable) hoverIndex = visualIndex;
		}}
		onpointerdown={reorderActive && !reorderGrip
			? (e) => onRowPointerDown(e, dataIndex, visualIndex)
			: undefined}
		{@attach ripple({ enabled: rowClickable && !editable })}>
		{#if reorderGrip}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<td
				class="grip-cell"
				role="gridcell"
				aria-label="Drag to reorder row {dataIndex + 1}"
				onpointerdown={(e) => onRowPointerDown(e, dataIndex, visualIndex)}>
				<svg
					class="grip-dots"
					viewBox="0 0 10 16"
					width="10"
					height="16"
					aria-hidden="true">
					<circle cx="2.5" cy="3" r="1.2" />
					<circle cx="7.5" cy="3" r="1.2" />
					<circle cx="2.5" cy="8" r="1.2" />
					<circle cx="7.5" cy="8" r="1.2" />
					<circle cx="2.5" cy="13" r="1.2" />
					<circle cx="7.5" cy="13" r="1.2" />
				</svg>
			</td>
		{/if}
		{#if selectable}
			<td class="checkbox-cell" role="gridcell">
				<div
					class="check-wrap"
					class:checked={rowSelected}
					class:preview={previewing}
					role="checkbox"
					tabindex="0"
					aria-checked={rowSelected}
					aria-label="Select row {dataIndex + 1}"
					{@attach ripple({ centered: true, opacity: 0.15 })}
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => {
						e.stopPropagation();
						toggleSelectRow(dataIndex, visualIndex, e);
					}}
					onkeydown={(e) => handleRowCheckKeydown(e, dataIndex, visualIndex)}>
					{@render checkIndicator(rowSelected || previewing, false, previewing)}
				</div>
			</td>
		{/if}
		{#if expandable}
			<td class="expand-cell" role="gridcell">
				<button
					class="expand-btn"
					type="button"
					aria-expanded={expandedRows.has(dataIndex)}
					aria-label={expandedRows.has(dataIndex) ? 'Collapse row' : 'Expand row'}
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => {
						e.stopPropagation();
						toggleExpand(dataIndex);
					}}>
					<svg
						class="expand-chevron"
						class:expanded={expandedRows.has(dataIndex)}
						width="15"
						height="15"
						viewBox="0 0 14 14"
						fill="none"
						aria-hidden="true">
						<path
							d="M5 3l4 4-4 4"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
				</button>
			</td>
		{/if}
		{#each columns as col, ci (col.key)}
			{@const rowId = keyOf(row, dataIndex)}
			{@const editableCell = resolveEditable(col, row)}
			{@const isBoolCol = editableCell && editorTypeOf(col) === 'boolean'}
			{@const ckey = cellKey(rowId, col.key)}
			{@const active = isActiveCell(rowId, col.key)}
			{@const dispVal = cellOptimistic.has(ckey)
				? cellOptimistic.get(ckey)
				: getCellValue(row, col.key)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<td
				style={getColumnStyle(col)}
				role="gridcell"
				class:col-resizing={resizing?.column_key === col.key}
				class:col-hover={hoveredResizeKey === col.key}
				class:editable-cell={editableCell}
				class:cell-active={active}
				class:cell-error={cellError.has(ckey)}
				data-no-drag={editableCell ? '' : undefined}
				tabindex={editableCell && !isBoolCol && !active
					? isRovingCell(rowId, col.key)
						? 0
						: -1
					: undefined}
				onclick={editableCell && !isBoolCol
					? (e) => handleCellClick(e, rowId, col.key)
					: undefined}
				onfocus={editableCell && !isBoolCol && !active
					? () => enterEdit(rowId, col.key)
					: undefined}>
				{#if isBoolCol}
					<!-- A persistent button (never swapped for an editor), so a single click
					     toggles it. Fills the cell so a click anywhere in it counts. -->
					<button
						type="button"
						class="cell-checkbox"
						role="switch"
						aria-checked={!!dispVal}
						aria-label={col.label}
						tabindex={active || isRovingCell(rowId, col.key) ? 0 : -1}
						onclick={(e) => {
							e.stopPropagation();
							toggleBooleanCell(rowId, col, row, dataIndex);
						}}
						onkeydown={(e) => booleanCellKeydown(e, rowId, col, row, dataIndex)}
						onfocus={() => enterEdit(rowId, col.key)}>
						<span class="cell-bool" class:checked={!!dispVal} aria-hidden="true">
							<svg viewBox="0 0 24 24" width="20" height="20" fill="none">
								<rect
									class="box"
									x="2"
									y="2"
									width="20"
									height="20"
									rx="3"
									stroke-width="2" />
								<path
									class="check"
									d="M6 12.5 L10 16.5 L18 8"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round" />
							</svg>
						</span>
					</button>
				{:else if active}
					{#key activeKey}
						<TableCellEditor
							column={col}
							{row}
							index={dataIndex}
							value={dispVal}
							errorMessage={cellError.get(ckey)}
							{dense}
							{comfortable}
							isFirstCell={isFirstNavCell({ row_id: rowId, col_key: col.key })}
							isLastCell={isLastNavCell({ row_id: rowId, col_key: col.key })}
							autoOpenMenu={autoOpenEditorMenu}
							oncommit={(d) => commitCell(rowId, col.key, row, dataIndex, col, d.value)}
							onliveinput={(d) => liveInput(rowId, col.key, row, dataIndex, col, d.value)}
							onnavigate={(d) => navigate(d.dir)}
							onexit={() => exitEdit(rowId, col.key)} />
					{/key}
				{:else if col.cell}
					{@render col.cell({ value: dispVal, row, index: dataIndex })}
				{:else}
					<span class="cell-text">{formatCell(col, dispVal, row)}</span>
				{/if}
				{#if editableCell && !isBoolCol && cellPending.has(ckey)}
					<span class="cell-status pending" aria-label="Saving">
						<Progress size="00" color="currentColor" />
					</span>
				{:else if editableCell && !isBoolCol && cellSaved.has(ckey)}
					<span class="cell-status saved" aria-hidden="true">
						<svg viewBox="0 0 18 18" width="16" height="16">
							<path
								d="M4 9.5l3.2 3.2L14 5.5"
								fill="none"
								stroke="currentColor"
								stroke-width="2.75"
								stroke-linecap="round"
								stroke-linejoin="round" />
						</svg>
					</span>
				{/if}
				{#if resizable && !active}
					{#if ci > 0}
						<!-- Left-edge zone: resizes the PREVIOUS column, covering the RIGHT
						     side of that border. Body cells are `overflow: hidden` for text
						     ellipsis, so a right-edge zone alone can only reach the LEFT side
						     of a border; pairing it with this one straddles the border from
						     both cells without anything needing to overflow. -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="resize-handle body start"
							class:active={resizing?.column_key === columns[ci - 1].key}
							data-resize-key={columns[ci - 1].key}
							aria-hidden="true"
							onpointerdown={(e) => startResize(e, columns[ci - 1].key)}
							ondblclick={(e) => autoFitColumn(e, columns[ci - 1].key)}>
						</span>
					{/if}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="resize-handle body"
						class:active={resizing?.column_key === col.key}
						class:edge={ci === columns.length - 1}
						data-resize-key={col.key}
						aria-hidden="true"
						onpointerdown={(e) => startResize(e, col.key)}
						ondblclick={(e) => autoFitColumn(e, col.key)}>
					</span>
				{/if}
			</td>
		{/each}
	</tr>
{/snippet}

{#snippet expandedRowTr(row: T, index: number)}
	<!-- svelte-ignore a11y_no_redundant_roles -->
	<tr class="expanded-row" role="row">
		<td colspan={totalColumns} role="gridcell">
			<div
				class="expanded-content"
				transition:slide={{
					duration: prefersReducedMotion() ? 0 : 240,
					easing: quintOut,
				}}
				{@attach measureExpanded(index)}>
				{#if expanded_row}
					{@render expanded_row(row)}
				{/if}
			</div>
		</td>
	</tr>
{/snippet}

<style>
	/* ========== Wrapper ========== */
	.wrapper {
		width: 100%;
		position: relative;
	}

	/* ========== Pagination ========== */
	/* The pager sits in its own bar above and/or below the bordered table frame.
	   `align` decides the layout: `between` (default) splits the info/summary to the
	   left and the page controls to the right; the others align the whole pager. */
	.pager {
		display: flex;
		align-items: center;
		padding-top: 0.875rem;

		&.top {
			padding-top: 0;
			padding-bottom: 0.875rem;
		}

		&.align-start {
			justify-content: flex-start;
		}
		&.align-center {
			justify-content: center;
		}
		&.align-end {
			justify-content: flex-end;
		}

		/* `between`: stretch the pager full-width and push just the page controls to
		   the far edge, leaving the rows-per-page selector + summary grouped left. */
		&.align-between :global(.pagination) {
			width: 100%;
		}
		&.align-between :global(.pagination .pagination-controls) {
			margin-left: auto;
		}
	}

	/* ========== Toolbar ========== */
	.toolbar {
		display: flex;
		justify-content: flex-end;
		padding: 0 0 0.5rem;
	}

	.export {
		position: relative;

		/* The trigger (the only direct button child; the menu options are nested
		   inside `.menu`). */
		> button {
			display: inline-flex;
			align-items: center;
			gap: 0.375rem;
			padding: 0.375rem 0.75rem;
			font-size: 0.8125rem;
			font-family: inherit;
			border: 1px solid
				light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
			border-radius: var(--radius-lg, 10px);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg, 10px) * var(--squircle-ratio, 2));
			}
			background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
			color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
			cursor: pointer;
			line-height: 1;

			&:hover {
				background: light-dark(
					rgb(from var(--color-text, #000) r g b / 0.04),
					rgb(from var(--color-text, #fff) r g b / 0.08)
				);
				transition: none;
			}
		}

		.menu {
			position: absolute;
			top: 100%;
			right: 0;
			margin-top: 0.25rem;
			min-width: 140px;
			background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
			border: 1px solid
				light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
			border-radius: var(--radius-lg, 10px);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg, 10px) * var(--squircle-ratio, 2));
			}
			box-shadow: 0 4px 12px rgb(0 0 0 / 0.1);
			z-index: 10;
			overflow: hidden;
		}

		.menu button {
			display: block;
			width: 100%;
			padding: 0.5rem 0.75rem;
			font-size: 0.8125rem;
			font-family: inherit;
			text-align: left;
			border: none;
			background: none;
			color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
			cursor: pointer;

			&:hover {
				background: light-dark(
					rgb(from var(--color-text, #000) r g b / 0.06),
					rgb(from var(--color-text, #fff) r g b / 0.08)
				);
			}

			&:not(:last-child) {
				border-bottom: 1px solid
					light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
			}
		}
	}

	/* ========== Scroll Container / Frame ========== */
	.scroll {
		/* Inline-size container so the row press can compute a fixed-pixel scale
		   from 100cqi (see .row.clickable:active). Safe here: this is a block
		   child of the 100%-width wrapper (no intrinsic sizing to lose), and the
		   drag overlay + overlay-scrollbar tracks mount in .wrapper, outside this
		   containment root, so the layout containment can't re-root them. */
		container-type: inline-size;
		overflow-x: auto;
		border: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #3a3a3a));
		border-radius: var(--table-radius, 14px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--table-radius, 14px) * var(--squircle-ratio, 2));
		}
		/* Clip the rounded corners over the table + sticky header */
	}

	/* Container scroller: the table scrolls vertically inside this frame (bounded
	   by `max-height`) and the sticky header pins to its top. */
	.scroll.bounded {
		overflow-y: auto;
	}

	/* External scroller (parent/window/custom): the frame must NOT establish its
	   own scroll container, so the chosen element's scrollbar drives the table.
	   `overflow: visible` on both axes keeps the frame transparent to scrolling. */
	.scroll.passthrough {
		overflow: visible;
	}

	/* Virtual-scroll spacers reserve the height of the off-screen rows above and
	   below the rendered window so the scrollbar reflects the full row count. */
	.v-spacer {
		display: block;
		grid-column: 1 / -1;
		padding: 0;
		border: none;
		background: none;
	}

	/* ========== Table (CSS grid + subgrid rows) ==========
	   Rendering as a grid (rather than native table layout) lets every <tr> be a
	   real block box — so a row can host a row-wide ripple/hover/press — while
	   subgrid keeps all the cells aligned to shared column tracks. Native
	   table/tr/td tags are kept (with explicit ARIA roles) for semantics. */
	table {
		display: grid;
		/* grid-template-columns is set inline from `gridTemplateColumns` */
		width: 100%;
		font-size: 0.875rem;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
	}

	/* Rowgroups collapse so each <tr> is a direct grid item of the table grid. */
	thead,
	tbody {
		display: contents;
	}

	tr {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		/* Cells stretch to the full row height so the vertical column dividers
		   span the whole row; each cell then centres its own content. */
		align-items: stretch;
	}

	/* ========== Header ========== */
	/* A recessed band (one+ step below the page bg, which the body rows sit on)
	   so the header reads as a distinct strip in both light and dark mode —
	   clearly deeper than the body's subtle stripe/hover tints. Opaque, because
	   the sticky header scrolls over the rows. */
	thead tr {
		border-bottom: 2px solid
			light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		background: light-dark(
			var(--color-bg-muted, #eef0f3),
			var(--color-bg-muted, #262626)
		);
	}

	thead tr.sticky {
		position: sticky;
		top: 0;
		z-index: 2;
	}

	th {
		display: flex;
		/* Stretch the inner button/content to fill the cell so the sort target
		   (and column divider) cover the full header height. */
		align-items: stretch;
		text-align: left;
		font-weight: 600;
		white-space: nowrap;
		min-width: 0;
		background: light-dark(
			var(--color-bg-muted, #eef0f3),
			var(--color-bg-muted, #262626)
		);
		/* Full-strength text (not muted): the header labels are wayfinding, they
		   must read at a glance. */
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		position: relative;
		user-select: none;
	}

	/* Vertical header dividers (subtle), skipped after the final column. The
	   header background is opaque, so a crisp border reads fine here. Body column
	   dividers are drawn separately (see `td::after`) so the row tint + ripple can
	   paint over them. */
	th:not(:last-child) {
		border-right: 1px solid
			light-dark(var(--color-border, #e8eaed), var(--color-border, #2b2b2b));
	}

	/* Non-interactive header content keeps the regular cell padding */
	.th-content {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.25rem;
		padding: 0.75rem 1rem;
	}

	.dense .th-content {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
	}

	.comfortable .th-content {
		padding: 1rem 1.25rem;
	}

	/* ========== Sortable header: full-cell Button-like target ========== */
	th.sortable {
		padding: 0;
	}

	.th-button {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.75rem 1rem;
		margin: 0;
		border: none;
		background: none;
		font: inherit;
		font-weight: 600;
		color: inherit;
		text-align: inherit;
		cursor: pointer;
		position: relative;
		overflow: hidden;
		user-select: none;
		transition:
			background-color 300ms ease,
			color 200ms ease,
			translate 200ms ease,
			scale 200ms ease;

		/* Instant hover tint (like Button), eased away on leave */
		&:hover {
			background-color: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.05),
				rgb(from var(--color-text, #fff) r g b / 0.07)
			);
			color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
			transition: color 200ms ease;
		}

		&:active {
			/* Centred scale + nudge == a pure-Z perspective press, kept off the
			   `transform` channel for the same reason as .row.clickable below. */
			translate: 0 0.95px;
			scale: 0.952;
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: -2px;
		}
	}

	.dense .th-button {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
	}

	.comfortable .th-button {
		padding: 1rem 1.25rem;
	}

	/* ========== Sort Icon ========== */
	.sort-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		/* Full-strength text so the affordance is legible; the inactive hint
		   stays lighter than the active arrow via its own opacity below. */
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
	}

	.sort-icon.active {
		color: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
	}

	/* Up/down hint shown on unsorted sortable columns — lighter than the active
	   arrow, but clearly legible at rest. */
	.arrow-hint {
		opacity: 0.55;
		transition:
			opacity 180ms ease,
			translate 180ms ease;
	}

	.th-button:hover .arrow-hint {
		opacity: 0.9;
	}

	/* Active arrow: rotates between asc/desc, pops in on first sort */
	.arrow-rot {
		display: inline-flex;
		transition: transform 300ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
	}

	.arrow-rot.desc {
		transform: rotate(180deg);
	}

	.arrow {
		animation: sort-pop 340ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
	}

	@keyframes sort-pop {
		0% {
			transform: scale(0.4);
			opacity: 0;
		}
		60% {
			transform: scale(1.18);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	/* ========== Resize Handle ==========
	   A generous, invisible hit zone straddling the 1px column divider — ~4px of
	   slack on each side, so you never have to land on the hairline. The divider
	   itself still renders at 1px; hovering or grabbing the zone springs a 2px
	   accent line to full height as the only visible affordance. */
	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		right: -4px;
		width: 9px;
		display: flex;
		align-items: stretch;
		justify-content: center;
		cursor: col-resize;
		z-index: 3;
		/* Own the gesture on touch so a drag resizes instead of scrolling. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
	}

	/* The last column's zone sits flush inside the frame (no negative offset) so it
	   can't overhang the table edge and spawn a px of phantom horizontal scroll. */
	.resize-handle.edge {
		right: 0;
		width: 8px;
		justify-content: flex-end;
	}

	/* Body-cell zones extend the drag target down every row so you can grab a
	   border anywhere, not just in the header. Each border is covered from BOTH
	   cells it sits between — the right edge of the cell on its left (`.body`) and
	   the left edge of the cell on its right (`.body.start`), both resizing the
	   same (left) column — so the target straddles the border ~6px on each side
	   while every zone stays fully inside its own cell. Keeping them in-cell (no
	   negative offset) means no column can overhang the frame and spawn a phantom
	   horizontal scrollbar. The visible feedback is the column's `td::after`
	   divider (see `.col-hover` / `.col-resizing`), so these carry no line. */
	.resize-handle.body {
		right: 0;
		width: 6px;
	}

	.resize-handle.body.start {
		left: 0;
		right: auto;
		width: 6px;
		justify-content: flex-start;
	}

	/* Header zones reach 2px past the header cell to cover the thead's 2px bottom
	   border, so the accent line is continuous from the header down through the
	   body instead of breaking at the header/body seam. */
	.resize-handle:not(.body) {
		bottom: -2px;
	}

	.resize-line {
		width: 2px;
		align-self: stretch;
		border-radius: 2px;
		background: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
		opacity: 0;
		transform: scaleY(0.5);
		transform-origin: center;
		transition:
			opacity 160ms ease,
			transform 240ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
			box-shadow 200ms ease;
	}

	/* Reveal the header accent line only when the pointer is actually inside a
	   resize zone (in the header OR any body cell of this column) — driven by
	   `hoveredResizeKey`, NOT by hovering the cell at large — and on keyboard
	   focus. It springs from a squished scaleY to full height. */
	th.col-hover .resize-line,
	.resize-handle:focus-visible .resize-line {
		opacity: 0.6;
		transform: scaleY(1);
	}

	/* Grabbing it (pointer down or while actively resizing): full-strength accent
	   with a soft glow that reads as "live". */
	.resize-handle:active .resize-line,
	.resize-handle.active .resize-line {
		opacity: 1;
		transform: scaleY(1);
		box-shadow:
			0 0 0 1px rgb(from var(--color-action, #1976d2) r g b / 0.35),
			0 0 8px rgb(from var(--color-action, #1976d2) r g b / 0.55);
	}

	.resize-handle:focus-visible {
		outline: none;
	}

	.resize-handle:focus-visible .resize-line {
		box-shadow: 0 0 0 2px var(--color-action, #1976d2);
	}

	/* Hover preview: the whole column boundary previews as a translucent 2px accent
	   line, head to foot, the moment the pointer enters a resize zone. Shown via
	   the body `td::after` dividers (and the header line above). The `:not(:last-
	   child)` both matches the base divider's structure and out-specifies it, so
	   the accent wins regardless of source order. */
	tbody td.col-hover:not(:last-child)::after {
		background: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.6),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.7)
		);
		width: 2px;
		z-index: 4;
		/* Reach 1px past the cell to cover the row divider, so the line reads as one
		   continuous stroke down the column rather than dashes between rows. */
		bottom: -1px;
	}

	/* While a column is being resized, light up its full-height boundary so it's
	   clear what's moving — a crisp solid accent divider plus a faint column wash.
	   The header keeps its opaque background (a sticky, translucent header would
	   show rows scrolling behind it), so only the body cells take the wash. */
	tbody td.col-resizing {
		background-color: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.05),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.08)
		);
	}

	tbody td.col-resizing:not(:last-child)::after {
		background: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
		width: 2px;
		/* Lift above the row tint + ripple for the duration of the drag. */
		z-index: 4;
		/* Bridge the row divider so the line is continuous (see `.col-hover`). */
		bottom: -1px;
	}

	/* The last row has no divider beneath it, so its accent must NOT overshoot the
	   cell — a 1px overshoot past the final row would add a phantom vertical
	   scrollbar (the frame's overflow-x:auto forces overflow-y to auto). */
	tbody tr.row:last-child td.col-hover::after,
	tbody tr.row:last-child td.col-resizing::after {
		bottom: 0;
	}

	/* ========== Body Rows ========== */
	/* Every body row is its own stacking context so its divider / tint / ripple
	   layers (all negative z-index) stay contained to that row. */
	tbody tr {
		position: relative;
		isolation: isolate;
	}

	tbody tr.row {
		border-bottom: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #2e2e2e));
	}

	/* The row background tint lives on a ::before layer (z-index -2) rather than
	   the row's own background, so the column dividers (z-index -3) can sit
	   BENEATH it — the tint, and then the ripple, paint over the lines. */
	tbody tr.row::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -2;
		background-color: var(--row-bg);
		transition: background-color 260ms ease;
		pointer-events: none;
	}

	/* Default tint at zero specificity, so the state rules below (also :where)
	   win purely by source order; the higher-specificity :hover rules still beat
	   them. (A plain `tbody tr.row` default would out-specify the states and
	   silently swallow the stripe/selected tints.) */
	:where(tbody tr.row) {
		--row-bg: transparent;
	}

	tbody tr.row:last-child {
		border-bottom: none;
	}

	td {
		display: flex;
		align-items: center;
		padding: 0.75rem 1rem;
		min-width: 0;
		/* Note: text clipping/ellipsis lives on the inner `.cell-text` (a flex cell
		   can't ellipsize its own text), which leaves the cell itself
		   `overflow: visible` — so the column-resize accent line (`td::after`) can
		   extend 1px past the cell to bridge the row dividers instead of being
		   chopped at each row. */
		/* Positioned so the divider pseudo anchors to the cell — but deliberately
		   NOT a stacking context (no z-index), so the divider's negative z-index
		   resolves in the row's stacking context, below the tint and ripple. */
		position: relative;
		/* Eases the column-resize wash in and out (see `td.col-resizing`). */
		transition: background-color 180ms ease;
	}

	/* Single-line text cells ellipsize here, not on the `td`: a flex container
	   can't apply `text-overflow` to its own text, so the text needs its own block
	   with `min-width: 0` (to allow shrinking) plus the clip/ellipsis. */
	.cell-text {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	/* Body column dividers: a low pseudo-layer (z-index -3) that sits BELOW the
	   row background tint (-2) and the ripple (-1), so the hover wash and the
	   ripple paint over the lines while the cell text stays on top. */
	tbody td:not(:last-child)::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		width: 1px;
		background: light-dark(var(--color-border, #e8eaed), var(--color-border, #2b2b2b));
		z-index: -3;
		pointer-events: none;
		/* Eases the accent into the divider when its column is being resized. */
		transition:
			background-color 180ms ease,
			width 180ms ease;
	}

	.dense td {
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
	}

	.comfortable td {
		padding: 1rem 1.25rem;
	}

	/* Clickable rows behave like buttons: pointer, press, and a row-wide ripple.
	   Because the row is a grid (not a table-row) box it can be overflow:hidden,
	   so the ripple attachment fills and clips to the row. The row's stacking
	   context (set on `tbody tr` above) keeps the ripple (z-index -1) above the
	   tint and dividers but below the cell content. */
	.row.clickable {
		cursor: pointer;
		user-select: none;
		overflow: hidden;
		/* The press eases on `translate`/`scale` ONLY — never `transform`. The reorder
		   gap-shift drives each row's `transform` (style:transform), and finishSettle
		   clears those shifts in the same tick the `.reordering` class drops; if
		   `transform` were transitioned here, that clear would animate and the settled
		   rows would jank. A pure-Z perspective press is exactly a centred scale +
		   nudge, so this reads identically to perspective(100px) translateZ(). */
		transition:
			translate 200ms ease,
			scale 200ms ease;

		&:active {
			translate: 0 2px;
			/* Two-axis press: x gives up --press-shrink of width no matter how
			   wide the row is (tan∘atan2 divides the two lengths; 100cqi is the
			   .scroll container's width) so a full-page row's edges never pull in
			   hugely; y squashes by Button's press ratio, which is what makes the
			   press *read* as a press. Plain-number fallback first for engines
			   without trig/cqi. Keep in sync with pressScaleFor() in the script. */
			scale: 0.99 var(--press-scale-y, 0.85);
			scale: clamp(0.9, 1 - tan(atan2(var(--press-shrink, 20px), 100cqi)), 1)
				var(--press-scale-y, 0.85);
		}
	}

	/* ---- Row background states (consumed by `tr.row::before`) ----
	   Resting states are written with :where() so they carry zero specificity and
	   resolve by source order (default → stripe → selected → preview); the
	   higher-specificity :hover rules below still win over all of them. */
	/* Striping is driven by an explicit parity class keyed on the row's visual
	   index (not :nth-child) so it stays stable while virtual scrolling swaps the
	   mounted rows, and doesn't flip when an expanded detail row is inserted. */
	:where(tbody tr.row.stripe) {
		--row-bg: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.03),
			rgb(from var(--color-text, #fff) r g b / 0.035)
		);
	}

	:where(tbody tr.row.selected) {
		--row-bg: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.1),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.16)
		);
	}

	/* Hover: a touch stronger than the stripe tint so it still reads clearly when
	   hovering a striped row. Snapped in (see the ::before rule), eased out.
	   Suppressed in `editable` tables, which tint the hovered CELL instead (the
	   `:where()` keeps specificity identical so the resting tints still resolve). */
	:where(table:not(.editable)) tbody tr.row:hover {
		--row-bg: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.06),
			rgb(from var(--color-text, #fff) r g b / 0.08)
		);
	}

	:where(table:not(.editable)) tbody tr.row.selected:hover {
		--row-bg: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.17),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.24)
		);
	}

	/* Shift-range preview wins over hover (placed last, equal specificity) */
	tbody tr.row.preview {
		--row-bg: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.14),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.2)
		);
	}

	/* Snap the tint in for hover/preview; the ::before eases it out otherwise. */
	tbody tr.row:hover::before,
	tbody tr.row.selected:hover::before,
	tbody tr.row.preview::before {
		transition: none;
	}

	/* ========== Inline editing ========== */
	/* Editable rows don't clip — so the active-cell ring, the validation tooltip,
	   and the autocomplete popover aren't cut off by the row's overflow. */
	.editable tbody tr.row {
		overflow: visible;
	}

	/* Editable mode replaces the row-level press feedback with per-cell editing, so
	   drop the clickable press scale (the ripple is disabled in markup). Row-level
	   selection/expand still work via the checkbox / grip controls. */
	.editable tbody tr.row.clickable {
		cursor: default;
	}
	.editable tbody tr.row.clickable:active {
		translate: none;
		scale: 1;
	}

	/* Per-cell hover affordance (replaces the row hover in editable tables). The
	   `td` base rule already eases `background-color` out; `:hover` drops it from
	   the transition so the tint snaps in (see packages/components/CLAUDE.md). */
	.editable td.editable-cell {
		cursor: cell;
	}
	.editable td.editable-cell:hover {
		background-color: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.05),
			rgb(from var(--color-text, #fff) r g b / 0.07)
		);
		transition: none;
	}

	/* The active cell: a crisp focus ring and an opaque background so the editor
	   reads cleanly over any stripe/selected tint. Kept below the sticky header
	   (z-index 2) and the resize wash (z-index 4). */
	.editable td.cell-active {
		z-index: 1;
		background-color: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		box-shadow: inset 0 0 0 2px var(--color-action, #1976d2);
		/* The ring snaps in; the cell hover/wash still eases via the base td rule. */
		transition: none;
	}
	/* A failed async save (or blocked validation) outlines the cell in the error
	   colour — wins over the active ring. */
	.editable td.cell-error,
	.editable td.cell-active.cell-error {
		box-shadow: inset 0 0 0 2px var(--color-error, #dc2626);
	}

	/* Save status badges on the resting cell (survive the editor unmounting). */
	.cell-status {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
		padding-left: 0.1rem;
		flex-shrink: 0;
		width: 1.5em;
		height: 1.5em;
	}
	.cell-status.pending {
		color: var(--color-action-fg, var(--color-action, #1976d2));
	}
	.cell-status.saved {
		color: var(--color-success, #16a34a);
		animation: cell-saved-pop 240ms cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.cell-status.saved svg {
		width: 100%;
		height: 100%;
		stroke-width: 2.75;
	}
	@keyframes cell-saved-pop {
		from {
			transform: scale(0.3);
			opacity: 0;
		}
	}

	/* Boolean cell button — fills the whole cell (it's `position: relative`), so a
	   single click anywhere toggles. Always present (never swapped for an editor),
	   which is what makes the first click register. */
	.cell-checkbox {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		perspective: 120px;
	}
	.cell-checkbox:focus-visible {
		outline: none;
	}
	/* Press feedback matching the Checkbox component: the indicator presses down and
	   scales in snappily (80ms), then eases back. A click anywhere in the cell
	   triggers it since the button fills the cell. */
	.cell-checkbox .cell-bool {
		transition: transform 150ms ease;
	}
	.cell-checkbox:active .cell-bool {
		transform: translateY(3px) scale(0.9);
		transition: transform 80ms ease;
	}

	/* Boolean indicator — matches the Checkbox component (and the editor's in-cell
	   toggle): accent-filled box with a drawn checkmark. */
	.cell-bool {
		display: inline-flex;
		flex-shrink: 0;
		line-height: 0;
	}
	.cell-bool .box {
		stroke: light-dark(
			var(--color-text-disabled, #999),
			var(--color-text-disabled, #777)
		);
		fill: transparent;
		transition:
			stroke 150ms ease,
			fill 150ms ease;
	}
	.cell-bool .check {
		stroke: transparent;
		fill: none;
		stroke-dasharray: 28;
		stroke-dashoffset: 28;
		transition:
			stroke-dashoffset 250ms ease,
			stroke 150ms ease;
	}
	.cell-bool.checked .box {
		stroke: var(--color-action, #1976d2);
		fill: var(--color-action, #1976d2);
	}
	.cell-bool.checked .check {
		stroke: var(--color-action-text, #fff);
		stroke-dashoffset: 0;
	}

	/* Reorder grip column (only when reorderable + editable). */
	.grip-cell {
		justify-content: center;
		align-items: center;
		padding-left: 0.25rem !important;
		padding-right: 0.25rem !important;
		cursor: grab;
		touch-action: none;
		color: light-dark(var(--color-text-muted, #9ca3af), var(--color-text-muted, #6b7280));
		transition: color 200ms ease;
	}
	.grip-cell:hover {
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		transition: none;
	}
	.grip-cell:active {
		cursor: grabbing;
	}
	.grip-dots {
		fill: currentColor;
		display: block;
	}

	@media (prefers-reduced-motion: reduce) {
		.cell-status.saved {
			animation: none;
		}
	}

	/* ========== Checkbox (mirrors the Checkbox component) ========== */
	.checkbox-cell {
		justify-content: center;
		text-align: center;
		padding-left: 0.5rem !important;
		padding-right: 0.25rem !important;
	}

	/* The header `th` uses `align-items: stretch` (so sortable column buttons fill
	   the cell height). For the select-all checkbox cell that would top-stretch the
	   round check-wrap; center it like the body checkbox cells instead. */
	th.checkbox-cell {
		align-items: center;
	}

	.check-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		cursor: pointer;
		flex-shrink: 0;
		overflow: hidden;
		outline: none;
		vertical-align: middle;
		-webkit-tap-highlight-color: transparent;
		--hover-tint: color-mix(in srgb, var(--color-text, currentColor) 12%, transparent);
		transition:
			background 200ms ease,
			transform 150ms ease;

		&.checked,
		&.preview {
			--hover-tint: color-mix(in srgb, var(--color-action, #1976d2) 18%, transparent);
		}

		&:hover {
			background: var(--hover-tint);
			transition: none;
		}

		&:active {
			transform: scale(0.9);
			transition:
				transform 80ms ease,
				background 200ms ease;
		}

		&:focus-visible {
			box-shadow:
				0 0 0 2px light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a)),
				0 0 0 4px var(--color-action, #1976d2);
		}
	}

	.check-icon {
		flex-shrink: 0;

		/* Unchecked outline: a clearly-visible, slightly thicker stroke so the
		   empty box reads well against the row background. */
		.box {
			stroke: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.5),
				rgb(from var(--color-text, #fff) r g b / 0.55)
			);
			stroke-width: 2.4;
			fill: transparent;
			transition:
				stroke 150ms ease,
				fill 150ms ease;
		}

		.check {
			stroke: var(--color-action-text, #fff);
			fill: none;
			stroke-dasharray: 24;
			stroke-dashoffset: 24;
			transition: stroke-dashoffset 260ms
				var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
		}

		.dash {
			stroke: var(--color-action-text, #fff);
		}

		&.checked {
			.box {
				stroke: var(--color-action, #1976d2);
				fill: var(--color-action, #1976d2);
			}
			.check {
				stroke-dashoffset: 0;
			}
		}

		/* Preview (shift-hover): tinted box, half-drawn check */
		&.preview {
			.box {
				stroke: var(--color-action, #1976d2);
				fill: rgb(from var(--color-action, #1976d2) r g b / 0.35);
			}
			.check {
				stroke: light-dark(var(--color-action, #1976d2), var(--color-action-text, #fff));
				stroke-dashoffset: 0;
				opacity: 0.55;
			}
		}
	}

	/* ========== Expand Cell ========== */
	.expand-cell {
		justify-content: center;
		text-align: center;
		padding-left: 0.5rem !important;
		padding-right: 0.25rem !important;
	}

	.expand-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		margin: 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		cursor: pointer;
		transition: background 160ms ease;

		&:hover {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.07),
				rgb(from var(--color-text, #fff) r g b / 0.1)
			);
			/* Snap the tint in on hover; the base rule eases it back out on leave. */
			transition: none;
		}

		&:active {
			transform: scale(0.9);
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: 1px;
		}
	}

	.expand-chevron {
		transition: transform 240ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
	}

	.expand-chevron.expanded {
		transform: rotate(90deg);
	}

	/* ========== Expanded Row ========== */
	.expanded-row {
		background: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.04),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.07)
		);
	}

	.expanded-row td {
		display: block;
		grid-column: 1 / -1;
		padding: 0;
		white-space: normal;
		overflow: visible;
		text-overflow: clip;
	}

	.expanded-content {
		padding: 1rem 1.25rem;
	}

	.dense .expanded-content {
		padding: 0.5rem 0.75rem;
	}

	.comfortable .expanded-content {
		padding: 1.25rem 1.5rem;
	}

	/* ========== Group Row ========== */
	.group-row {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.03),
			rgb(from var(--color-text, #fff) r g b / 0.05)
		);
	}

	.group-row td {
		display: block;
		grid-column: 1 / -1;
		padding: 0;
	}

	.group-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 1rem;
		border: none;
		background: none;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		font: inherit;
		font-weight: 600;
		font-size: 0.8125rem;
		cursor: pointer;
		text-transform: uppercase;
		letter-spacing: 0.02em;

		&:hover {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.04),
				rgb(from var(--color-text, #fff) r g b / 0.06)
			);
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: -2px;
			border-radius: 2px;
		}
	}

	.group-chevron {
		transition: transform 200ms ease;
		flex-shrink: 0;
	}

	.group-chevron:not(.group-collapsed) {
		transform: rotate(90deg);
	}

	.group-count {
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		font-weight: 400;
		font-size: 0.75rem;
	}

	/* ========== Empty State ========== */
	.empty-row td {
		display: block;
		grid-column: 1 / -1;
		padding: 0;
		white-space: normal;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
	}

	.empty p {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
	}

	/* ========== Skeleton ========== */
	.skeleton-row {
		pointer-events: none;
		border-bottom: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #2e2e2e));

		/* Real rows drop the last border (see tr.row:last-child) — mirror it so
		   the skeleton table is exactly as tall as the loaded one. */
		&:last-child {
			border-bottom: none;
		}
	}

	/* Text-line bar inside a real `td` (which supplies the real cell padding,
	   incl. dense/comfortable): the bar's margins pad it out to one full text
	   line (1lh), so skeleton rows are exactly as tall as loaded rows. */
	.skeleton-bar {
		height: 0.7em;
		margin-block: calc((1lh - 0.7em) / 2);
		border-radius: var(--radius-full, 1e5px);
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
			animation-delay: var(--shimmer-delay, 0s);
		}

		/* Checkbox/expand glyph placeholders size themselves inline (18px squares /
		   discs) — no text-line margins. */
		&.glyph {
			margin-block: 0;
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

	/* ========== Reorder (drag-to-reorder) ========== */
	/* A draggable row hints with a grab cursor. We deliberately leave
	   `touch-action` at its default (`auto`) instead of an explicit `pan-y`: a
	   declared pan axis lets the browser drive that scroll on the compositor and
	   makes the `touchmove` non-cancelable, so an armed drag could never stop the
	   page from scrolling. With `auto`, the non-passive `touchmove` guard (see
	   `onDragTouchMove`) can preventDefault once a long-press arms the drag, while
	   an un-armed drag still scrolls the list normally. */
	.row.reorderable {
		cursor: grab;
		/* Suppress the mobile long-press text-selection callout: a hold on a cell's
		   text would otherwise pop the OS selection menu instead of arming the drag.
		   This has to live on the row (not just `.wrapper.reordering`) because the
		   callout fires during the hold, before the drag starts. `touch-callout`
		   covers iOS; Android's `contextmenu` event is handled in JS (see
		   `onDragContextMenu`). A whole-row drag already precludes drag-to-select on
		   desktop, so nothing usable is lost there. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	/* While a drag is in flight: kill text selection and show the grabbing cursor
	   everywhere over the table. */
	.wrapper.reordering {
		user-select: none;
		cursor: grabbing;
	}

	/* While resizing: the col-resize cursor stays put across the whole table even
	   as the pointer drifts off the thin handle, and nothing selects underneath. */
	.wrapper.resizing-active {
		cursor: col-resize;
		user-select: none;
		-webkit-user-select: none;
	}

	/* Disable pointer events on the body rows during a drag so the rows beneath
	   the floating overlay don't light up with :hover (the overlay is
	   pointer-events:none and would otherwise let hover bleed through). The drag
	   itself is driven by document-level listeners, so rows don't need events. */
	.wrapper.reordering tbody tr {
		pointer-events: none;
	}

	.wrapper.reordering .row {
		transition: transform 200ms cubic-bezier(0.2, 0.85, 0.3, 1);
		will-change: transform;
	}

	/* The press would fight the drag transform — suppress it mid-reorder. */
	.wrapper.reordering .row.clickable:active {
		translate: none;
		scale: none;
	}

	/* The lifted originals stay in flow (so scroll height is stable) but are
	   hidden — the floating overlay shows the moving copy. */
	.row.drag-source {
		visibility: hidden;
	}

	.wrapper.reordering .row.drag-source {
		transition: none;
	}

	/* Touch "ready to move" feedback: the held row lifts before it can be moved. */
	.row.drag-armed {
		z-index: 5;
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		animation: arm 180ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) forwards;
	}

	@keyframes arm {
		from {
			transform: scale(1);
			box-shadow: 0 0 0 rgb(0 0 0 / 0);
		}
		to {
			transform: scale(1.015);
			box-shadow:
				0 10px 24px rgb(0 0 0 / 0.16),
				0 3px 8px rgb(0 0 0 / 0.12);
		}
	}

	/* The floating overlay (fixed-position, follows the pointer). The drop-shadow
	   gives the "popped above the rest" lift; position (translate) and lift (scale)
	   are applied imperatively as separate properties so the pointer-follow stays
	   instant while `scale` carries the lift-in and drop-settle transitions. */
	.drag-overlay {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 1000;
		display: grid;
		pointer-events: none;
		filter: drop-shadow(0 18px 32px rgb(0 0 0 / 0.22))
			drop-shadow(0 6px 12px rgb(0 0 0 / 0.16));
		border-radius: var(--table-radius, 14px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--table-radius, 14px) * var(--squircle-ratio, 2));
		}
		overflow: hidden;
		will-change: translate, scale;
	}

	.drag-overlay.settling {
		filter: drop-shadow(0 6px 14px rgb(0 0 0 / 0.12));
		transition: filter 300ms ease;
	}

	/* Many-row drag: the overlay collapses to a single card with a count badge and
	   a couple of "sheets" peeking behind it (so it reads as a stack), instead of a
	   tall block. The gap in the list still reserves every row. */
	.drag-overlay.collapsed {
		overflow: visible;
	}

	.drag-overlay.collapsed .ghost-row {
		border-radius: var(--table-radius, 14px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--table-radius, 14px) * var(--squircle-ratio, 2));
		}
		overflow: hidden;
	}

	.drag-overlay.collapsed::before,
	.drag-overlay.collapsed::after {
		content: '';
		position: absolute;
		left: 5px;
		right: 5px;
		top: 0;
		bottom: 0;
		z-index: -1;
		border-radius: var(--table-radius, 14px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--table-radius, 14px) * var(--squircle-ratio, 2));
		}
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #232323));
		border: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #3a3a3a));
	}

	.drag-overlay.collapsed::before {
		transform: translateY(5px) scale(0.99);
	}

	.drag-overlay.collapsed::after {
		left: 10px;
		right: 10px;
		transform: translateY(10px) scale(0.985);
		opacity: 0.85;
	}

	.drag-count {
		position: absolute;
		top: 50%;
		right: 12px;
		transform: translateY(-50%);
		min-width: 1.5rem;
		height: 1.5rem;
		padding: 0 0.45rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--color-action, #1976d2);
		color: var(--color-action-text, #fff);
		font-size: 0.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.25);
	}

	.ghost-row {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		font-size: 0.875rem;
	}

	.ghost-row:not(:last-child) {
		border-bottom: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #2e2e2e));
	}

	.ghost-cell {
		display: flex;
		align-items: center;
		padding: 0.75rem 1rem;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.drag-overlay.dense .ghost-cell {
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
	}

	.drag-overlay.comfortable .ghost-cell {
		padding: 1rem 1.25rem;
	}

	.ghost-cell.checkbox-cell,
	.ghost-cell.expand-cell {
		justify-content: center;
		padding-left: 0.5rem;
		padding-right: 0.25rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar::after {
			animation: none;
		}
		.expand-chevron,
		.group-chevron,
		.arrow-rot,
		.arrow,
		.check-icon .check,
		.row.clickable,
		tbody tr.row,
		tbody tr.row::before,
		.th-button,
		.row.drag-armed,
		.wrapper.reordering .row,
		.drag-overlay,
		.drag-overlay.settling,
		.resize-line {
			animation: none !important;
			transition: none !important;
		}
	}
</style>
