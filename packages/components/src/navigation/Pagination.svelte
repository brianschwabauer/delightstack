<script lang="ts">
	const propId = $props.id();
	let {
		/** Current page number (1-based) */
		page = $bindable(1),

		/** Total number of pages */
		totalPages,

		/** Total number of items (used for info display) */
		totalItems = undefined as number | undefined,

		/** Number of items per page */
		pageSize = $bindable(10),

		/** Options for the page size selector */
		pageSizeOptions = [10, 25, 50, 100],

		/** Simple mode: prev/next with "Page X of Y" */
		simple = false,

		/** Compact mode: minimal prev/next with "X / Y" */
		compact = false,

		/** Show a page size selector */
		showPageSize = false,

		/** Show item range info ("Showing X-Y of Z") */
		showInfo = false,

		/** Number of sibling pages to show around the current page */
		siblingCount = 1,

		/** Number of pages to always show at the start and end */
		boundaryCount = 1,

		/** Size of the pagination buttons */
		size = '1' as '0' | '1' | '2' | '3',

		/** Show skeleton placeholder */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Callback when the page changes */
		onchange = undefined as ((detail: { page: number }) => void) | undefined,

		/** Callback when the page size changes */
		onpagesizechange = undefined as ((detail: { pageSize: number }) => void) | undefined,
	}: {
		page?: number;
		totalPages: number;
		totalItems?: number;
		pageSize?: number;
		pageSizeOptions?: number[];
		simple?: boolean;
		compact?: boolean;
		showPageSize?: boolean;
		showInfo?: boolean;
		siblingCount?: number;
		boundaryCount?: number;
		size?: '0' | '1' | '2' | '3';
		skeleton?: boolean;
		id?: string;
		class?: string;
		onchange?: (detail: { page: number }) => void;
		onpagesizechange?: (detail: { pageSize: number }) => void;
	} = $props();

	const SIZE_MAP: Record<string, { min_width: string; height: string; font_size: string }> = {
		'0': { min_width: '1.5rem', height: '1.5rem', font_size: 'var(--font-size-0, 0.75rem)' },
		'1': { min_width: '2rem', height: '2rem', font_size: 'var(--font-size-1, 0.875rem)' },
		'2': { min_width: '2.5rem', height: '2.5rem', font_size: 'var(--font-size-2, 1rem)' },
		'3': { min_width: '3rem', height: '3rem', font_size: 'var(--font-size-3, 1.125rem)' },
	};

	const sizeConfig = $derived(SIZE_MAP[size] || SIZE_MAP['1']);

	const isFirstPage = $derived(page <= 1);
	const isLastPage = $derived(page >= totalPages);

	/**
	 * Ellipsis algorithm: compute the list of page numbers and ellipsis markers.
	 * Returns an array of numbers (page numbers) and strings ('...') for gaps.
	 */
	const pageRange = $derived.by(() => {
		if (totalPages <= 0) return [];

		const range: (number | '...')[] = [];

		// Compute boundary sets
		const startBoundary = Math.min(boundaryCount, totalPages);
		const endBoundaryStart = Math.max(totalPages - boundaryCount + 1, startBoundary + 1);

		// Compute sibling range around current page
		const siblingStart = Math.max(page - siblingCount, 1);
		const siblingEnd = Math.min(page + siblingCount, totalPages);

		// Collect all page numbers that should appear
		const pages = new Set<number>();

		// Add start boundary pages
		for (let i = 1; i <= startBoundary; i++) {
			pages.add(i);
		}

		// Add end boundary pages
		for (let i = endBoundaryStart; i <= totalPages; i++) {
			pages.add(i);
		}

		// Add sibling pages (and current page)
		for (let i = siblingStart; i <= siblingEnd; i++) {
			pages.add(i);
		}

		// Convert to sorted array and insert ellipses for gaps
		const sorted = [...pages].sort((a, b) => a - b);

		for (let i = 0; i < sorted.length; i++) {
			if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
				range.push('...');
			}
			range.push(sorted[i]);
		}

		return range;
	});

	const infoText = $derived.by(() => {
		if (!showInfo || totalItems === undefined) return '';
		const start = (page - 1) * pageSize + 1;
		const end = Math.min(page * pageSize, totalItems);
		return `Showing ${start}\u2013${end} of ${totalItems}`;
	});

	function goToPage(newPage: number) {
		if (newPage < 1 || newPage > totalPages || newPage === page) return;
		page = newPage;
		onchange?.({ page: newPage });
	}

	function handlePrev() {
		goToPage(page - 1);
	}

	function handleNext() {
		goToPage(page + 1);
	}

	function handlePageSizeChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		const newSize = Number(target.value);
		pageSize = newSize;
		page = 1;
		onpagesizechange?.({ pageSize: newSize });
		onchange?.({ page: 1 });
	}
</script>

<nav
	{id}
	class={['pagination', className].filter(Boolean).join(' ')}
	class:skeleton
	aria-label="Pagination"
	style:--pg-min-width={sizeConfig.min_width}
	style:--pg-height={sizeConfig.height}
	style:--pg-font-size={sizeConfig.font_size}>

	{#if skeleton}
		<div class="skeleton-inner"></div>
	{:else}
		{#if showPageSize}
			<label class="page-size-label">
				<span class="page-size-text">Rows</span>
				<select
					class="page-size-select"
					value={String(pageSize)}
					onchange={handlePageSizeChange}>
					{#each pageSizeOptions as opt}
						<option value={String(opt)} selected={opt === pageSize}>{opt}</option>
					{/each}
				</select>
			</label>
		{/if}

		{#if showInfo && infoText}
			<span class="pagination-info">{infoText}</span>
		{/if}

		<div class="pagination-controls">
			{#if compact}
				<!-- Compact mode: < 6 / 11 > -->
				<button
					type="button"
					class="pagination-button"
					disabled={isFirstPage}
					aria-disabled={isFirstPage}
					aria-label="Go to previous page"
					onclick={handlePrev}>
					<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
					</svg>
				</button>
				<span class="pagination-compact-info">{page} / {totalPages}</span>
				<button
					type="button"
					class="pagination-button"
					disabled={isLastPage}
					aria-disabled={isLastPage}
					aria-label="Go to next page"
					onclick={handleNext}>
					<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
					</svg>
				</button>
			{:else if simple}
				<!-- Simple mode: < Prev   Page 6 of 11   Next > -->
				<button
					type="button"
					class="pagination-button pagination-prev"
					disabled={isFirstPage}
					aria-disabled={isFirstPage}
					aria-label="Go to previous page"
					onclick={handlePrev}>
					<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
					</svg>
					<span>Prev</span>
				</button>
				<span class="pagination-simple-info">Page {page} of {totalPages}</span>
				<button
					type="button"
					class="pagination-button pagination-next"
					disabled={isLastPage}
					aria-disabled={isLastPage}
					aria-label="Go to next page"
					onclick={handleNext}>
					<span>Next</span>
					<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
					</svg>
				</button>
			{:else}
				<!-- Default mode: < Prev  1  2  ...  5  [6]  7  ...  10  11  Next > -->
				<button
					type="button"
					class="pagination-button pagination-prev"
					disabled={isFirstPage}
					aria-disabled={isFirstPage}
					aria-label="Go to previous page"
					onclick={handlePrev}>
					<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
					</svg>
					<span>Prev</span>
				</button>

				{#each pageRange as item}
					{#if item === '...'}
						<span class="pagination-ellipsis" aria-hidden="true">&hellip;</span>
					{:else}
						<button
							type="button"
							class="pagination-button pagination-page"
							class:current={item === page}
							aria-current={item === page ? 'page' : undefined}
							aria-label="Go to page {item}"
							onclick={() => goToPage(item)}>
							{item}
						</button>
					{/if}
				{/each}

				<button
					type="button"
					class="pagination-button pagination-next"
					disabled={isLastPage}
					aria-disabled={isLastPage}
					aria-label="Go to next page"
					onclick={handleNext}>
					<span>Next</span>
					<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
					</svg>
				</button>
			{/if}
		</div>
	{/if}
</nav>

<style>
	.pagination {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: var(--pg-font-size);
	}

	.pagination.skeleton {
		pointer-events: none;
		min-height: var(--pg-height);
		min-width: 12rem;
		border-radius: var(--radius-md, 0.375rem);
		position: relative;
		overflow: hidden;
	}

	.skeleton-inner {
		width: 100%;
		height: 100%;
		position: absolute;
		inset: 0;
		background: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
		border-radius: var(--radius-md, 0.375rem);

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
			animation: pagination-shimmer 2s infinite;
		}
	}

	.pagination-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.pagination-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--pg-min-width);
		height: var(--pg-height);
		border-radius: var(--radius-md, 0.375rem);
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0 0.375em;
		font-size: inherit;
		font-family: inherit;
		gap: 0.25em;
		transition: background 100ms ease;
		white-space: nowrap;

		&:hover:not(:disabled) {
			background: light-dark(
				var(--color-bg-subtle, #f5f5f5),
				var(--color-bg-subtle, #1a1a1a)
			);
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #2563eb);
			outline-offset: 1px;
		}

		&.current {
			background: var(--color-action, #2563eb);
			color: var(--color-action-text, white);

			&:hover {
				background: var(--color-action-active, #1d4ed8);
			}
		}

		&:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}

		svg {
			flex-shrink: 0;
		}
	}

	.pagination-ellipsis {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--pg-min-width);
		height: var(--pg-height);
		color: var(--color-text-muted, #6b7280);
		user-select: none;
	}

	.pagination-simple-info {
		padding: 0 0.75em;
		white-space: nowrap;
		color: var(--color-text-muted, #6b7280);
	}

	.pagination-compact-info {
		padding: 0 0.25em;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.pagination-info {
		white-space: nowrap;
		color: var(--color-text-muted, #6b7280);
		font-size: 0.875em;
	}

	.page-size-label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		white-space: nowrap;
		font-size: 0.875em;
		color: var(--color-text-muted, #6b7280);
	}

	.page-size-select {
		appearance: auto;
		border: 1px solid light-dark(
			var(--color-border, #d1d5db),
			var(--color-border, #4b5563)
		);
		border-radius: var(--radius-md, 0.375rem);
		background: light-dark(
			var(--color-bg, white),
			var(--color-bg, #0a0a0a)
		);
		color: inherit;
		font-size: inherit;
		font-family: inherit;
		padding: 0.25em 0.5em;
		height: var(--pg-height);
		cursor: pointer;

		&:focus-visible {
			outline: 2px solid var(--color-action, #2563eb);
			outline-offset: 1px;
		}
	}

	@keyframes pagination-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-inner::after {
			animation: none;
		}

		.pagination-button {
			transition: none;
		}
	}
</style>
