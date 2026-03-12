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
		onsort = undefined as ((payload: { column: string; direction: 'asc' | 'desc' }) => void) | undefined,

		/** Selection changed */
		onselect = undefined as ((payload: { selected: T[] }) => void) | undefined,

		/** Row clicked */
		onrowclick = undefined as ((payload: { row: T; index: number }) => void) | undefined,

		/** Column resized */
		oncolumnresize = undefined as ((payload: { column: string; width: number }) => void) | undefined,
	} = $props();

	// ---- Internal state ----
	let columnWidths = $state<Record<string, number>>({});
	let resizing = $state<{ column_key: string; start_x: number; start_width: number } | null>(null);
	let expandedRows = $state(new Set<number>());
	let collapsedGroups = $state(new Set<string>());
	let lastSelectedIndex = $state<number | null>(null);
	let showExportMenu = $state(false);

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

	// ---- Grouped data ----
	interface Group {
		key: string;
		label: string;
		rows: { row: T; original_index: number }[];
	}

	const groupedData = $derived.by((): Group[] | null => {
		if (!groupBy) return null;
		const groupKey = groupBy;
		const map = new Map<string, { row: T; original_index: number }[]>();
		const order: string[] = [];
		for (let i = 0; i < sortedData.length; i++) {
			const val = String(sortedData[i][groupKey] ?? 'Other');
			if (!map.has(val)) {
				map.set(val, []);
				order.push(val);
			}
			map.get(val)!.push({ row: sortedData[i], original_index: i });
		}
		return order.map((key) => ({
			key,
			label: key,
			rows: map.get(key)!,
		}));
	});

	// ---- Flat rows for rendering ----
	const flatRows = $derived.by((): { row: T; original_index: number }[] => {
		return sortedData.map((row, i) => ({ row, original_index: i }));
	});

	// ---- Total columns count ----
	const totalColumns = $derived(columns.length + (selectable ? 1 : 0) + (expandable ? 1 : 0));

	// ---- Select all state ----
	const allSelected = $derived(data.length > 0 && selected.length === data.length);
	const someSelected = $derived(selected.length > 0 && selected.length < data.length);

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

	function handleSortKeydown(e: KeyboardEvent, columnKey: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleSort(columnKey);
		}
	}

	// ---- Selection ----
	function isSelected(row: T): boolean {
		return selected.includes(row);
	}

	function toggleSelectAll() {
		if (allSelected) {
			selected = [];
		} else {
			selected = [...data];
		}
		onselect?.({ selected });
	}

	function toggleSelectRow(row: T, index: number, event?: MouseEvent) {
		if (event?.shiftKey && lastSelectedIndex !== null) {
			const start = Math.min(lastSelectedIndex, index);
			const end = Math.max(lastSelectedIndex, index);
			const rangeRows = sortedData.slice(start, end + 1);
			const newSelected = new Set(selected);
			for (const r of rangeRows) {
				newSelected.add(r);
			}
			selected = [...newSelected];
		} else {
			if (isSelected(row)) {
				selected = selected.filter((r) => r !== row);
			} else {
				selected = [...selected, row];
			}
		}
		lastSelectedIndex = index;
		onselect?.({ selected });
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
			const newWidth = Math.max(minW, resizing.start_width + (ev.clientX - resizing.start_x));
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
	function handleRowClick(row: T, index: number, event: MouseEvent) {
		// Don't fire row click if clicking checkbox or expand button
		const target = event.target as HTMLElement;
		if (target.closest('.ds-table-checkbox') || target.closest('.ds-table-expand-btn')) return;

		if (expandable) {
			toggleExpand(index);
		}
		onrowclick?.({ row, index });
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

	// ---- Column style ----
	function getColumnStyle(col: Column<T>): string {
		const parts: string[] = [];
		const w = columnWidths[col.key];
		if (w) {
			parts.push(`width: ${w}px`);
		} else if (col.width) {
			parts.push(`width: ${col.width}`);
		}
		if (col.minWidth) {
			parts.push(`min-width: ${col.minWidth}`);
		}
		if (col.align) {
			parts.push(`text-align: ${col.align}`);
		}
		return parts.join('; ');
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
		if (!related?.closest('.ds-table-export')) {
			showExportMenu = false;
		}
	}

</script>

<div
	class={['ds-table-wrapper', className].filter(Boolean).join(' ')}
	class:ds-table-dense={dense}
	class:ds-table-comfortable={comfortable}
	class:ds-table-striped={striped}
	{id}
>
	{#if exportable}
		<div class="ds-table-toolbar">
			<div class="ds-table-export" onfocusout={handleExportBlur}>
				<button
					class="ds-table-export-btn"
					type="button"
					aria-haspopup="true"
					aria-expanded={showExportMenu}
					onclick={() => (showExportMenu = !showExportMenu)}
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path d="M8 2v8M8 10L5 7M8 10l3-3M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					Export
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
						<path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
				{#if showExportMenu}
					<div class="ds-table-export-menu" role="menu">
						<button class="ds-table-export-option" type="button" role="menuitem" onclick={exportCSV}>
							Export CSV
						</button>
						<button class="ds-table-export-option" type="button" role="menuitem" onclick={exportJSON}>
							Export JSON
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="ds-table-scroll">
		<table role="grid">
			<thead class:ds-table-sticky={stickyHeader}>
				<tr>
					{#if selectable}
						<th class="ds-table-checkbox-cell" style="width: 3rem">
							<label class="ds-table-checkbox">
								<input
									type="checkbox"
									checked={allSelected}
									indeterminate={someSelected}
									aria-label="Select all rows"
									onchange={toggleSelectAll}
								/>
								<span class="ds-table-checkbox-icon">
									{#if allSelected}
										<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
											<path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
										</svg>
									{:else if someSelected}
										<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
											<path d="M3 7h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
										</svg>
									{/if}
								</span>
							</label>
						</th>
					{/if}
					{#if expandable}
						<th class="ds-table-expand-cell" style="width: 2.5rem"></th>
					{/if}
					{#each columns as col (col.key)}
						<th
							style={getColumnStyle(col)}
							aria-sort={getAriaSort(col)}
							class:ds-table-sortable={col.sortable}
						>
							<div class="ds-table-th-content">
								{#if col.header}
									{@render col.header({ column: col })}
								{:else if col.sortable}
									<button
										class="ds-table-sort-btn"
										type="button"
										onclick={() => handleSort(col.key)}
										onkeydown={(e) => handleSortKeydown(e, col.key)}
									>
										<span>{col.label}</span>
										<span class="ds-table-sort-icon" class:ds-table-sort-active={sortBy === col.key}>
											{#if sortBy === col.key && sortDirection === 'asc'}
												<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
													<path d="M7 11V3M7 3L3.5 6.5M7 3l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
												</svg>
											{:else if sortBy === col.key && sortDirection === 'desc'}
												<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
													<path d="M7 3v8M7 11l3.5-3.5M7 11L3.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
												</svg>
											{:else}
												<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style="opacity: 0.3">
													<path d="M7 3v8M7 3L4 6M7 3l3 3M7 11L4 8M7 11l3-3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
												</svg>
											{/if}
										</span>
									</button>
								{:else}
									<span>{col.label}</span>
								{/if}
								{#if resizableColumns}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<span
										class="ds-table-resize-handle"
										onmousedown={(e) => startResize(e, col.key)}
										ondblclick={(e) => autoFitColumn(e, col.key)}
									></span>
								{/if}
							</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if skeleton}
					{#each { length: skeletonCount } as _, ri}
						<tr class="ds-table-skeleton-row" aria-hidden="true">
							{#if selectable}
								<td class="ds-table-checkbox-cell">
									<div class="ds-table-skeleton-bar" style="width: 18px; height: 18px; border-radius: 4px;"></div>
								</td>
							{/if}
							{#if expandable}
								<td class="ds-table-expand-cell">
									<div class="ds-table-skeleton-bar" style="width: 18px; height: 18px; border-radius: 50%;"></div>
								</td>
							{/if}
							{#each columns as col, ci (col.key)}
								<td style={col.align ? `text-align: ${col.align}` : ''}>
									<div class="ds-table-skeleton-bar" style="width: {getSkeletonWidth(ri, ci)}; animation-delay: {(ri * columns.length + ci) * 50}ms"></div>
								</td>
							{/each}
						</tr>
					{/each}
				{:else if data.length === 0}
					<tr class="ds-table-empty-row">
						<td colspan={totalColumns}>
							{#if empty}
								{@render empty()}
							{:else}
								<div class="ds-table-empty">
									<svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
										<rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
										<line x1="6" y1="18" x2="42" y2="18" stroke="currentColor" stroke-width="2" opacity="0.3"/>
										<line x1="18" y1="18" x2="18" y2="38" stroke="currentColor" stroke-width="2" opacity="0.2"/>
									</svg>
									<p>No data available</p>
								</div>
							{/if}
						</td>
					</tr>
				{:else if groupedData}
					{#each groupedData as group (group.key)}
						<tr class="ds-table-group-row">
							<td colspan={totalColumns}>
								<button
									class="ds-table-group-toggle"
									type="button"
									onclick={() => toggleGroup(group.key)}
									aria-expanded={!collapsedGroups.has(group.key)}
								>
									<svg
										class="ds-table-group-chevron"
										class:ds-table-group-collapsed={collapsedGroups.has(group.key)}
										width="14"
										height="14"
										viewBox="0 0 14 14"
										fill="none"
										aria-hidden="true"
									>
										<path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
									</svg>
									<span class="ds-table-group-label">{group.label}</span>
									<span class="ds-table-group-count">({group.rows.length})</span>
								</button>
							</td>
						</tr>
						{#if !collapsedGroups.has(group.key)}
							{#each group.rows as { row, original_index } (original_index)}
								{@render dataRow(row, original_index)}
								{#if expandable && expandedRows.has(original_index) && expandedRow}
									{@render expandedRowTr(row, original_index)}
								{/if}
							{/each}
						{/if}
					{/each}
				{:else}
					{#each flatRows as { row, original_index } (original_index)}
						{@render dataRow(row, original_index)}
						{#if expandable && expandedRows.has(original_index) && expandedRow}
							{@render expandedRowTr(row, original_index)}
						{/if}
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>

{#snippet dataRow(row: T, index: number)}
	<tr
		class="ds-table-row"
		class:ds-table-row-selected={selectable && isSelected(row)}
		class:ds-table-row-expanded={expandable && expandedRows.has(index)}
		class:ds-table-row-clickable={!!onrowclick || expandable}
		onclick={(e) => handleRowClick(row, index, e)}
	>
		{#if selectable}
			<td class="ds-table-checkbox-cell">
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
				<label class="ds-table-checkbox" onclick={(e) => e.stopPropagation()}>
					<input
						type="checkbox"
						checked={isSelected(row)}
						aria-label="Select row {index + 1}"
						onclick={(e) => toggleSelectRow(row, index, e as unknown as MouseEvent)}
					/>
					<span class="ds-table-checkbox-icon">
						{#if isSelected(row)}
							<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
								<path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						{/if}
					</span>
				</label>
			</td>
		{/if}
		{#if expandable}
			<td class="ds-table-expand-cell">
				<button
					class="ds-table-expand-btn"
					type="button"
					aria-expanded={expandedRows.has(index)}
					aria-label={expandedRows.has(index) ? 'Collapse row' : 'Expand row'}
					onclick={(e) => { e.stopPropagation(); toggleExpand(index); }}
				>
					<svg
						class="ds-table-expand-chevron"
						class:ds-table-expanded={expandedRows.has(index)}
						width="14"
						height="14"
						viewBox="0 0 14 14"
						fill="none"
						aria-hidden="true"
					>
						<path d="M5 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
			</td>
		{/if}
		{#each columns as col (col.key)}
			<td style={getColumnStyle(col)}>
				{#if col.cell}
					{@render col.cell({ value: getCellValue(row, col.key), row, index })}
				{:else}
					{getCellValue(row, col.key) ?? ''}
				{/if}
			</td>
		{/each}
	</tr>
{/snippet}

{#snippet expandedRowTr(row: T, index: number)}
	<tr class="ds-table-expanded-row">
		<td colspan={totalColumns}>
			<div class="ds-table-expanded-content">
				{#if expandedRow}
					{@render expandedRow(row)}
				{/if}
			</div>
		</td>
	</tr>
{/snippet}

<style>
	/* ========== Wrapper ========== */
	.ds-table-wrapper {
		width: 100%;
		position: relative;
	}

	/* ========== Toolbar ========== */
	.ds-table-toolbar {
		display: flex;
		justify-content: flex-end;
		padding: 0 0 0.5rem;
	}

	.ds-table-export {
		position: relative;
	}

	.ds-table-export-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
		font-family: inherit;
		border: 1px solid light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		border-radius: var(--radius-3, 6px);
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		cursor: pointer;
		line-height: 1;

		&:hover {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.04),
				rgb(from var(--color-text, #fff) r g b / 0.08)
			);
		}
	}

	.ds-table-export-menu {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 0.25rem;
		min-width: 140px;
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		border: 1px solid light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		border-radius: var(--radius-3, 6px);
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.1);
		z-index: 10;
		overflow: hidden;
	}

	.ds-table-export-option {
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
			border-bottom: 1px solid light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		}
	}

	/* ========== Scroll Container ========== */
	.ds-table-scroll {
		overflow-x: auto;
	}

	/* ========== Table ========== */
	table {
		width: 100%;
		border-collapse: collapse;
		border-spacing: 0;
		font-size: 0.875rem;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
	}

	/* ========== Header ========== */
	thead {
		&.ds-table-sticky {
			position: sticky;
			top: 0;
			z-index: 1;
		}
	}

	thead tr {
		border-bottom: 2px solid light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
	}

	th {
		padding: 0.75rem 1rem;
		text-align: left;
		font-weight: 600;
		white-space: nowrap;
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		position: relative;
		user-select: none;
	}

	.ds-table-dense th {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
	}

	.ds-table-comfortable th {
		padding: 1rem 1.25rem;
	}

	/* ========== Sort Button ========== */
	.ds-table-th-content {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.ds-table-sort-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0;
		margin: 0;
		border: none;
		background: none;
		font: inherit;
		font-weight: 600;
		color: inherit;
		cursor: pointer;

		&:hover {
			color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: 2px;
			border-radius: 2px;
		}
	}

	.ds-table-sort-icon {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		transition: opacity 150ms ease;
	}

	.ds-table-sort-active {
		color: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
	}

	/* ========== Resize Handle ========== */
	.ds-table-resize-handle {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		cursor: col-resize;
		opacity: 0;
		background: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
		transition: opacity 150ms ease;
	}

	th:hover .ds-table-resize-handle {
		opacity: 1;
	}

	/* ========== Body Rows ========== */
	tbody tr {
		border-bottom: 1px solid light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
	}

	td {
		padding: 0.75rem 1rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ds-table-dense td {
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
	}

	.ds-table-comfortable td {
		padding: 1rem 1.25rem;
	}

	.ds-table-row-clickable {
		cursor: pointer;
	}

	.ds-table-row:hover {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.03),
			rgb(from var(--color-text, #fff) r g b / 0.04)
		);
	}

	.ds-table-row-selected {
		background: light-dark(
			rgb(from var(--color-action, #1976d2) r g b / 0.08),
			rgb(from var(--color-action, #5c9ce6) r g b / 0.12)
		) !important;
	}

	/* ========== Striped ========== */
	.ds-table-striped tbody tr.ds-table-row:nth-child(even) {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.02),
			rgb(from var(--color-text, #fff) r g b / 0.03)
		);
	}

	.ds-table-striped tbody tr.ds-table-row:nth-child(even):hover {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.05),
			rgb(from var(--color-text, #fff) r g b / 0.06)
		);
	}

	/* ========== Checkbox Cell ========== */
	.ds-table-checkbox-cell {
		width: 3rem;
		text-align: center;
		padding-left: 0.75rem !important;
		padding-right: 0.25rem !important;
	}

	.ds-table-checkbox {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		position: relative;
	}

	.ds-table-checkbox input[type='checkbox'] {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
		pointer-events: none;
	}

	.ds-table-checkbox-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border: 2px solid light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		border-radius: 4px;
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a));
		transition: border-color 150ms ease, background-color 150ms ease;
		flex-shrink: 0;
		color: light-dark(var(--color-action-text, #fff), var(--color-action-text, #fff));
	}

	.ds-table-checkbox input[type='checkbox']:checked + .ds-table-checkbox-icon,
	.ds-table-checkbox input[type='checkbox']:indeterminate + .ds-table-checkbox-icon {
		background: var(--color-action, #1976d2);
		border-color: var(--color-action, #1976d2);
	}

	.ds-table-checkbox input[type='checkbox']:focus-visible + .ds-table-checkbox-icon {
		box-shadow: 0 0 0 2px light-dark(var(--color-bg, #fff), var(--color-bg, #1a1a1a)), 0 0 0 4px var(--color-action, #1976d2);
	}

	/* ========== Expand Cell ========== */
	.ds-table-expand-cell {
		width: 2.5rem;
		text-align: center;
		padding-left: 0.5rem !important;
		padding-right: 0.25rem !important;
	}

	.ds-table-expand-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		margin: 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		cursor: pointer;

		&:hover {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.06),
				rgb(from var(--color-text, #fff) r g b / 0.08)
			);
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: 1px;
		}
	}

	.ds-table-expand-chevron {
		transition: transform 200ms ease;
	}

	.ds-table-expanded {
		transform: rotate(90deg);
	}

	/* ========== Expanded Row ========== */
	.ds-table-expanded-row {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.015),
			rgb(from var(--color-text, #fff) r g b / 0.02)
		);
	}

	.ds-table-expanded-row td {
		padding: 0;
	}

	.ds-table-expanded-content {
		padding: 1rem 1.25rem;
	}

	.ds-table-dense .ds-table-expanded-content {
		padding: 0.5rem 0.75rem;
	}

	.ds-table-comfortable .ds-table-expanded-content {
		padding: 1.25rem 1.5rem;
	}

	/* ========== Group Row ========== */
	.ds-table-group-row {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.03),
			rgb(from var(--color-text, #fff) r g b / 0.05)
		);
	}

	.ds-table-group-row td {
		padding: 0;
	}

	.ds-table-group-toggle {
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

	.ds-table-group-chevron {
		transition: transform 200ms ease;
		flex-shrink: 0;
	}

	.ds-table-group-chevron:not(.ds-table-group-collapsed) {
		transform: rotate(90deg);
	}

	.ds-table-group-count {
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		font-weight: 400;
		font-size: 0.75rem;
	}

	/* ========== Empty State ========== */
	.ds-table-empty-row td {
		padding: 0;
	}

	.ds-table-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
	}

	.ds-table-empty p {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
	}

	/* ========== Skeleton ========== */
	.ds-table-skeleton-row {
		pointer-events: none;
	}

	.ds-table-skeleton-bar {
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
			animation: ds-table-shimmer 2s infinite;
		}
	}

	@keyframes ds-table-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ds-table-skeleton-bar::after {
			animation: none;
		}
		.ds-table-expand-chevron,
		.ds-table-group-chevron {
			transition: none;
		}
	}
</style>
