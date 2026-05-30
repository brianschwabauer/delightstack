<script lang="ts" module>
	export interface Column<T> {
		key: string;
		label: string;
		sortable?: boolean;
		width?: string;
		minWidth?: string;
		align?: 'left' | 'center' | 'right';
		cell?: import('svelte').Snippet<[{ value: unknown; row: T; index: number }]>;
		header?: import('svelte').Snippet<[{ column: Column<T> }]>;
	}
</script>

<script lang="ts" generics="T extends Record<string, unknown>">
	import type { Snippet } from 'svelte';
	import { ripple } from '@delightstack/utilities';
	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	const propId = $props.id();

	let {
		/** Array of row data */
		data = [] as T[],

		/** Column definitions */
		columns = [] as Column<T>[],

		/** Current sort column key */
		sortBy = $bindable(undefined) as string | undefined,

		/** Sort direction */
		sortDirection = $bindable('asc') as 'asc' | 'desc',

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
		stickyHeader = true,

		/** Column resize by drag */
		resizableColumns = false,

		/** Row expansion */
		expandable = false,

		/** Group rows by column key */
		groupBy = undefined as string | undefined,

		/** Enable CSV/JSON export */
		exportable = false,

		/** Loading skeleton */
		skeleton = false,

		/** Skeleton rows */
		skeletonCount = 5,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Custom empty state */
		empty = undefined as Snippet | undefined,

		/** Expanded row content */
		expandedRow = undefined as Snippet<[T]> | undefined,

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
	} = $props();

	// ---- Internal state ----
	let columnWidths = $state<Record<string, number>>({});
	let resizing = $state<{
		column_key: string;
		start_x: number;
		start_width: number;
	} | null>(null);
	let expandedRows = $state(new Set<number>());
	let collapsedGroups = $state(new Set<string>());
	// Anchor + hovered row tracked as VISUAL positions so shift-range follows the
	// rows as displayed (after sorting/grouping), not their order in `data`.
	let lastSelectedVisual = $state<number | null>(null);
	let showExportMenu = $state(false);

	// Shift-range preview state
	let shiftHeld = $state(false);
	let hoverIndex = $state<number | null>(null);

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

	// ---- Sorted data ----
	const sortedData = $derived.by(() => {
		if (!sortBy || onsort) return data;
		const key = sortBy;
		const dir = sortDirection === 'asc' ? 1 : -1;
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
		if (!groupBy) return null;
		const groupKey = groupBy;
		const map = new Map<string, RenderRow[]>();
		const order: string[] = [];
		for (let i = 0; i < sortedData.length; i++) {
			const row = sortedData[i];
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
		return sortedData.map((row, i) => ({
			row,
			data_index: rowIndexMap.get(row) ?? i,
			visual_index: i,
		}));
	});

	// ---- Total columns count ----
	const totalColumns = $derived(
		columns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0),
	);

	// ---- Grid track template ----
	// The table renders as a CSS grid (with subgrid rows) instead of a native
	// table layout, so each <tr> is a real block box that can host a row-wide
	// ripple, hover and press effects. The column tracks are declared here so
	// every subgrid row stays aligned.
	const gridTemplateColumns = $derived.by(() => {
		const tracks: string[] = [];
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

		if (sortBy === columnKey) {
			if (sortDirection === 'asc') {
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
			sortBy = newSortBy;
			sortDirection = newDirection;
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
				const di = rowIndexMap.get(sortedData[v]);
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
	function startResize(e: MouseEvent, columnKey: string) {
		e.preventDefault();
		e.stopPropagation();
		const th = (e.target as HTMLElement).closest('th') as HTMLElement | null;
		const startWidth = columnWidths[columnKey] || th?.offsetWidth || 100;
		resizing = { column_key: columnKey, start_x: e.clientX, start_width: startWidth };

		function onMouseMove(ev: MouseEvent) {
			if (!resizing) return;
			const col = columns.find((c) => c.key === resizing!.column_key);
			const minW = parseInt(col?.minWidth || '50', 10);
			const newWidth = Math.max(
				minW,
				resizing.start_width + (ev.clientX - resizing.start_x),
			);
			columnWidths[resizing.column_key] = newWidth;
		}

		function onMouseUp() {
			if (resizing) {
				const finalWidth = columnWidths[resizing.column_key];
				if (finalWidth) {
					oncolumnresize?.({ column: resizing.column_key, width: finalWidth });
				}
			}
			resizing = null;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		}

		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	function autoFitColumn(e: MouseEvent, columnKey: string) {
		e.preventDefault();
		e.stopPropagation();
		// Reset to auto width
		delete columnWidths[columnKey];
		columnWidths = { ...columnWidths };
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
		const target = event.target as HTMLElement;
		// Clicks on the checkbox or expand toggle are handled by those controls.
		if (target.closest('.dt-check-wrap') || target.closest('.expand-btn')) return;

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
			col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start';
		return `justify-content: ${justify}; text-align: ${col.align}`;
	}

	// ---- Cell value access ----
	function getCellValue(row: T, key: string): unknown {
		return row[key];
	}

	// ---- Aria sort ----
	function getAriaSort(col: Column<T>): 'ascending' | 'descending' | 'none' | undefined {
		if (!col.sortable) return undefined;
		if (sortBy !== col.key) return 'none';
		return sortDirection === 'asc' ? 'ascending' : 'descending';
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
</script>

<div
	class={['wrapper', className].filter(Boolean).join(' ')}
	class:dense={dense}
	class:comfortable={comfortable}
	class:striped={striped}
	{id}>
	{#if exportable}
		<div class="toolbar">
			<div class="export" onfocusout={handleExportBlur}>
				<button
					class="export-btn"
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
					<div class="export-menu" role="menu">
						<button
							class="export-option"
							type="button"
							role="menuitem"
							onclick={exportCSV}>
							Export CSV
						</button>
						<button
							class="export-option"
							type="button"
							role="menuitem"
							onclick={exportJSON}>
							Export JSON
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scroll" onmouseleave={() => (hoverIndex = null)}>
		<table role="grid" style:grid-template-columns={gridTemplateColumns}>
			<!-- The CSS `display` override (grid/subgrid) strips the implicit ARIA
			     roles of the native table elements, so they are restored explicitly.
			     Svelte's a11y_no_redundant_roles check can't see the CSS, hence the
			     ignores below. -->
			<thead>
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<tr role="row" class:sticky={stickyHeader}>
					{#if selectable}
						<th class="checkbox-cell" role="columnheader">
							<div
								class="dt-check-wrap"
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
					{#each columns as col (col.key)}
						<th
							style={getColumnStyle(col)}
							role="columnheader"
							aria-sort={getAriaSort(col)}
							class:sortable={col.sortable && !col.header}>
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
								<span class="th-label">{col.label}</span>
								<span class="sort-icon" class:active={sortBy === col.key}>
									{#if sortBy === col.key}
										<span class="arrow-rot" class:desc={sortDirection === 'desc'}>
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
						{#if resizableColumns}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								class="resize-handle"
								onmousedown={(e) => startResize(e, col.key)}
								ondblclick={(e) => autoFitColumn(e, col.key)}>
							</span>
						{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if skeleton}
					{#each { length: skeletonCount } as _, ri}
						<tr class="skeleton-row" aria-hidden="true">
							{#if selectable}
								<td class="checkbox-cell">
									<div
										class="skeleton-bar"
										style="width: 18px; height: 18px; border-radius: 5px;">
									</div>
								</td>
							{/if}
							{#if expandable}
								<td class="expand-cell">
									<div
										class="skeleton-bar"
										style="width: 18px; height: 18px; border-radius: 50%;">
									</div>
								</td>
							{/if}
							{#each columns as col, ci (col.key)}
								<td style={col.align ? `text-align: ${col.align}` : ''}>
									<div
										class="skeleton-bar"
										style="width: {getSkeletonWidth(ri, ci)}; animation-delay: {(ri *
											columns.length +
											ci) *
											50}ms">
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
							{#each group.rows as { row, data_index, visual_index } (data_index)}
								{@render dataRow(row, data_index, visual_index)}
								{#if expandable && expandedRows.has(data_index) && expandedRow}
									{@render expandedRowTr(row, data_index)}
								{/if}
							{/each}
						{/if}
					{/each}
				{:else}
					{#each flatRows as { row, data_index, visual_index } (data_index)}
						{@render dataRow(row, data_index, visual_index)}
						{#if expandable && expandedRows.has(data_index) && expandedRow}
							{@render expandedRowTr(row, data_index)}
						{/if}
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>

{#snippet checkIndicator(checked: boolean, indeterminate: boolean, preview: boolean)}
	<svg
		class="dt-check"
		class:checked={checked || indeterminate}
		class:indeterminate={indeterminate}
		class:preview={preview}
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
	<!-- svelte-ignore a11y_no_redundant_roles a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
	<tr
		role="row"
		class="row"
		class:selected={rowSelected}
		class:preview={previewing}
		class:clickable={rowClickable}
		onclick={(e) => handleRowClick(row, dataIndex, visualIndex, e)}
		onmouseenter={() => {
			if (selectable) hoverIndex = visualIndex;
		}}
		{@attach ripple({ enabled: rowClickable })}>
		{#if selectable}
			<td class="checkbox-cell" role="gridcell">
				<div
					class="dt-check-wrap"
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
		{#each columns as col (col.key)}
			<td style={getColumnStyle(col)} role="gridcell">
				{#if col.cell}
					{@render col.cell({ value: getCellValue(row, col.key), row, index: dataIndex })}
				{:else}
					{getCellValue(row, col.key) ?? ''}
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
				}}>
				{#if expandedRow}
					{@render expandedRow(row)}
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

	/* ========== Toolbar ========== */
	.toolbar {
		display: flex;
		justify-content: flex-end;
		padding: 0 0 0.5rem;
	}

	.export {
		position: relative;
	}

	.export-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
		font-family: inherit;
		border: 1px solid
			light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		border-radius: var(--radius-3, 10px);
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

	.export-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.25rem;
		min-width: 140px;
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		border: 1px solid
			light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		border-radius: var(--radius-3, 10px);
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.1);
		z-index: 10;
		overflow: hidden;
	}

	.export-option {
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

	/* ========== Scroll Container / Frame ========== */
	.scroll {
		overflow-x: auto;
		border: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #3a3a3a));
		border-radius: var(--table-radius, 14px);
		/* Clip the rounded corners over the table + sticky header */
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
	thead tr {
		border-bottom: 2px solid
			light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
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
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		position: relative;
		user-select: none;
	}

	/* Vertical column dividers (subtle), skipped after the final column. */
	th:not(:last-child),
	td:not(:last-child) {
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
			translate 200ms ease;

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
			translate: 0 1px;
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
		color: light-dark(var(--color-text-muted, #9ca3af), var(--color-text-muted, #9ca3af));
	}

	.sort-icon.active {
		color: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
	}

	/* Faint up/down hint shown on unsorted sortable columns */
	.arrow-hint {
		opacity: 0.35;
		transition:
			opacity 180ms ease,
			translate 180ms ease;
	}

	.th-button:hover .arrow-hint {
		opacity: 0.7;
	}

	/* Active arrow: rotates between asc/desc, pops in on first sort */
	.arrow-rot {
		display: inline-flex;
		transition: transform 300ms var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1));
	}

	.arrow-rot.desc {
		transform: rotate(180deg);
	}

	.arrow {
		animation: sort-pop 340ms var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1));
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

	/* ========== Resize Handle ========== */
	.resize-handle {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 5px;
		cursor: col-resize;
		opacity: 0;
		z-index: 3;
		background: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
		transition: opacity 150ms ease;
	}

	th:hover .resize-handle {
		opacity: 1;
	}

	/* ========== Body Rows ========== */
	tbody tr.row {
		--row-bg: transparent;
		background-color: var(--row-bg);
		border-bottom: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #2e2e2e));
		transition: background-color 260ms ease;
	}

	tbody tr.row:last-child {
		border-bottom: none;
	}

	td {
		display: flex;
		align-items: center;
		padding: 0.75rem 1rem;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dense td {
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
	}

	.comfortable td {
		padding: 1rem 1.25rem;
	}

	/* Clickable rows behave like buttons: pointer, press, and a row-wide ripple.
	   Because the row is a grid (not a table-row) box it can be position:relative
	   + overflow:hidden, so the ripple attachment fills and clips to the row.
	   `isolation` gives the row its own stacking context so the ripple (z-index
	   -1) sits above the row background but below the cell content. */
	.row.clickable {
		cursor: pointer;
		user-select: none;
		position: relative;
		overflow: hidden;
		isolation: isolate;
		transition:
			background-color 260ms ease,
			translate 200ms ease;

		&:active {
			translate: 0 1px;
		}
	}

	/* ---- Row background states ----
	   Base/resting states are written with :where() so they carry zero
	   specificity; the :hover rules below always win, giving the
	   "instant-in, eased-out" hover behaviour even over striped/selected. */
	:where(.striped tbody tr.row:nth-child(even)) {
		--row-bg: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.025),
			rgb(from var(--color-text, #fff) r g b / 0.035)
		);
	}

	:where(tbody tr.row.selected) {
		--row-bg: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.1),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.16)
		);
	}

	/* Hover: instant tint, removed on leave so the base transition fades it out */
	tbody tr.row:hover {
		--row-bg: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.045),
			rgb(from var(--color-text, #fff) r g b / 0.06)
		);
		transition: none;
	}

	tbody tr.row.selected:hover {
		--row-bg: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.17),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.24)
		);
		transition: none;
	}

	/* Shift-range preview wins over hover (placed last, equal specificity) */
	tbody tr.row.preview {
		--row-bg: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.14),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.2)
		);
		transition: none;
	}

	/* ========== Checkbox (mirrors the Checkbox component) ========== */
	.checkbox-cell {
		justify-content: center;
		text-align: center;
		padding-left: 0.5rem !important;
		padding-right: 0.25rem !important;
	}

	.dt-check-wrap {
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
			box-shadow: 0 0 0 2px light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a)),
				0 0 0 4px var(--color-action, #1976d2);
		}
	}

	.dt-check {
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
			transition: stroke-dashoffset 260ms var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1));
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
		transition: transform 240ms var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1));
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
	}

	.skeleton-bar {
		height: 1rem;
		border-radius: var(--radius-3, 6px);
		background: light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			left: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: shimmer 2s infinite;
		}
	}

	@keyframes shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar::after {
			animation: none;
		}
		.expand-chevron,
		.group-chevron,
		.arrow-rot,
		.arrow,
		.dt-check .check,
		.row.clickable,
		tbody tr.row,
		.th-button {
			animation: none !important;
			transition: none !important;
		}
	}
</style>
