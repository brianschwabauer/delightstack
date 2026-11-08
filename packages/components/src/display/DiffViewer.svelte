<script lang="ts">
	/**
	 * A word-level diff of two texts, inline or side-by-side.
	 *
	 * The alignment, the line numbers and the context collapsing all come from
	 * `diff-model.ts`, which is pure and testable on its own. This file is the
	 * rendering: a real `<table>`, `<del>` and `<ins>` for the spans, and a
	 * per-row label for a screen reader — because `<del>`/`<ins>` are announced
	 * inconsistently and "what changed on this line" is the question being asked.
	 *
	 * Both modes read the same rows. A row carries both sides, so side-by-side is
	 * two cells instead of one rather than a second pass over the model.
	 */

	import { renderDiffHTML, type DiffOp } from '@delightstack/diff';
	import {
		buildDiffModel,
		hunksFromText,
		mergeRowOps,
		nextChange,
		previousChange,
		type DiffGranularity,
		type DiffHunk,
		type DiffRow,
	} from './diff-model.js';

	const prop_id = $props.id();
	let {
		/** The old text. Ignored when `hunks` is given. */
		before = '',

		/** The new text. Ignored when `hunks` is given. */
		after = '',

		/**
		 * Pre-aligned spans, for a caller that knows which parts of the two
		 * documents correspond — blocks paired by id, rows paired by key. Takes
		 * precedence over `before` / `after`.
		 */
		hunks = undefined as DiffHunk[] | undefined,

		/** `'inline'` weaves both sides into one column; `'side-by-side'` splits them. */
		mode = 'inline' as 'inline' | 'side-by-side',

		/** How text inside a changed span is compared. Prose wants `'word'`. */
		granularity = 'word' as DiffGranularity,

		/** Unchanged lines kept either side of a change. `Infinity` collapses nothing. */
		context_lines = 3,

		/** Wrap long lines instead of scrolling the table sideways. */
		wrap = true,

		/** Show the old and new line numbers in the gutter. */
		show_line_numbers = true,

		/** Column heading for the old side, in `'side-by-side'`. */
		label_before = 'Before',

		/** Column heading for the new side, in `'side-by-side'`. */
		label_after = 'After',

		/** Maximum height before the diff scrolls. */
		max_height = undefined as string | undefined,

		/** Element ID */
		id = prop_id,

		/** Additional CSS classes */
		class: class_name = '',
	}: {
		before?: string;
		after?: string;
		hunks?: DiffHunk[];
		mode?: 'inline' | 'side-by-side';
		granularity?: DiffGranularity;
		context_lines?: number;
		wrap?: boolean;
		show_line_numbers?: boolean;
		label_before?: string;
		label_after?: string;
		max_height?: string;
		id?: string;
		class?: string;
	} = $props();

	const model = $derived(
		buildDiffModel(hunks ?? hunksFromText(before, after), { granularity, context_lines }),
	);

	/** Sections the reader has opened. Keyed by the first row each one hides. */
	let expanded = $state(new Set<number>());

	/**
	 * What the reader is looking at, cheaply.
	 *
	 * The reset below cannot key on `hunks` itself: a caller that rebuilds its
	 * hunk array on every render — the ordinary case for a `$derived` — hands
	 * over a new array identity with the same content each time, and the reset
	 * would fire on every keystroke and slam every expanded section shut. So it
	 * keys on what the comparison *is*: how many spans, the first and last
	 * identities, the two lengths and the ends of the text. Cheap, and wrong only
	 * for an edit that changes neither length nor either end — which leaves a
	 * section open that is still in the same place.
	 */
	const comparison_key = $derived(
		[
			granularity,
			context_lines,
			hunks
				? `h:${hunks.length}:${hunks[0]?.key ?? ''}:${hunks[hunks.length - 1]?.key ?? ''}`
				: `t:${before.length}:${after.length}:${before.slice(0, 48)}:${after.slice(-48)}`,
		].join('\u0000'),
	);

	// A new comparison is a new set of sections, so what was open no longer means
	// anything. Keyed on the inputs rather than on `model`, which re-runs when
	// only the mode changed.
	$effect(() => {
		void comparison_key;
		expanded = new Set();
	});

	const row_index = $derived(new Map(model.rows.map((row, index) => [row, index])));

	const columns = $derived(
		(mode === 'side-by-side' ? 2 : 1) + (show_line_numbers ? 2 : 0),
	);

	const LABEL: Record<DiffRow['kind'], string> = {
		equal: '',
		insert: 'Added',
		delete: 'Removed',
		replace: 'Changed',
	};

	function rowLabel(row: DiffRow): string {
		if (row.moved_stub) {
			return row.moved_to_line === null
				? 'Moved away'
				: `Moved to line ${row.moved_to_line}`;
		}
		const change = LABEL[row.kind];
		if (row.moved) {
			const where =
				row.moved_from_line === null ? 'Moved' : `Moved from line ${row.moved_from_line}`;
			// The word diff inside a moved span is drawn whether or not the caller
			// set `changed`, so the label follows the row rather than the flag.
			return change ? `${where}, ${change.toLowerCase()}` : where;
		}
		return change;
	}

	/* ------------------------------------------------------------------ */
	/*  Moves                                                              */
	/* ------------------------------------------------------------------ */

	/**
	 * Each end of a move, by row, pointing at the other end's row.
	 *
	 * Matched on the pair's indices, the same way `resolveMoveLines` matches
	 * them — but on *rows*, because which way the reader has to scroll is a
	 * question about where the two ends sit on the page and not about their line
	 * numbers.
	 */
	const move_partner = $derived.by(() => {
		const stubs = new Map<string, number>();
		const heads = new Map<string, number>();
		model.rows.forEach((row, index) => {
			if (!row.moved) return;
			const key = `${row.moved_from ?? ''} ${row.moved_to ?? ''}`;
			if (row.moved_stub) stubs.set(key, index);
			else if (row.moved_head) heads.set(key, index);
		});
		const partner = new Map<number, number>();
		for (const [key, stub] of stubs) {
			const head = heads.get(key);
			if (head === undefined) continue;
			partner.set(stub, head);
			partner.set(head, stub);
		}
		return partner;
	});

	/**
	 * The visible text of a move marker.
	 *
	 * A glyph and a direction as well as a colour, because a move is the third
	 * thing this component says and the other two are already spoken in green
	 * and red — a reader who cannot separate those hues has nothing left to read
	 * a third by. `⇅` marks both ends, and the arrow points at the *other* end —
	 * the way to scroll to find it, which is the one fact the two ends do not
	 * share.
	 *
	 * The arrow is read off the two rows' positions rather than off their line
	 * numbers, because the numbers count in two different documents. Fifty lines
	 * deleted above a move leave the destination's new number *below* the
	 * source's old one while the destination is still further down the page, and
	 * an arrow answering from the numbers sends the reader the wrong way.
	 */
	function moveMarker(row: DiffRow): string {
		const self = row_index.get(row);
		const other = self === undefined ? undefined : move_partner.get(self);
		const arrow =
			self === undefined || other === undefined ? '' : other > self ? ' ↓' : ' ↑';
		if (row.moved_stub) {
			const target = row.moved_to_line;
			if (target === null) return '⇅ Moved away';
			return `⇅ Moved to line ${target}${arrow}`;
		}
		const source = row.moved_from_line;
		if (source === null) return '⇅ Moved';
		return `⇅ Moved from line ${source}${arrow}`;
	}

	/** A moved span's first row, and stubs, carry the marker. Nothing else does. */
	function hasMarker(row: DiffRow): boolean {
		return row.moved && (row.moved_stub || row.moved_head);
	}

	/* ------------------------------------------------------------------ */
	/*  Keyboard: n / p step through the changes                           */
	/* ------------------------------------------------------------------ */

	let container = $state<HTMLElement | undefined>(undefined);
	let cursor = $state(-1);

	function focusRow(index: number) {
		if (index < 0) return;
		cursor = index;
		// A change inside a collapsed section cannot happen — collapsing only ever
		// hides unchanged rows — so the row is always in the DOM.
		const element = container?.querySelector<HTMLElement>(`[data-row="${index}"]`);
		element?.focus();
		element?.scrollIntoView({ block: 'nearest' });
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		// Only a control that consumes typed characters swallows the shortcuts. A
		// focused expander button deliberately does not: expanding a section is
		// how a reader gets *to* the part of the diff they want to step through,
		// and taking `n` away at that moment is the opposite of helpful.
		const target = event.target as HTMLElement | null;
		if (target?.isContentEditable) return;
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		if (event.key === 'n') {
			event.preventDefault();
			focusRow(nextChange(model, cursor));
		} else if (event.key === 'p') {
			event.preventDefault();
			focusRow(previousChange(model, cursor < 0 ? model.rows.length : cursor));
		}
	}

	/**
	 * Open a collapsed section, and catch the focus its button leaves behind.
	 *
	 * The button is removed by the very click that activates it, so focus would
	 * fall back to `<body>` — and from there the region's own `keydown` never
	 * fires, so `n` and `p` stop working the moment someone expands anything.
	 */
	function expand(first_row: number) {
		expanded = new Set(expanded).add(first_row);
		container?.focus();
	}

	/**
	 * One line's ops as a string of markup.
	 *
	 * Through the diff package's own renderer, which escapes every op's text and
	 * validates the tag names, so the result is safe whatever the document
	 * contained. It is a string rather than Svelte elements for a second reason:
	 * the `<span>` is emitted here, so nothing can put whitespace between it and
	 * the text — and that span is the only element in the cell that preserves
	 * whitespace, which is what makes a diff of indented text honest without a
	 * formatter's line breaks leaking into it.
	 */
	function lineHTML(ops: DiffOp[]): string {
		return `<span class="line">${renderDiffHTML(ops)}</span>`;
	}

	function summary(): string {
		const { added, removed, changed, moved } = model.stats;
		const parts: string[] = [];
		if (added) parts.push(`${added} added`);
		if (removed) parts.push(`${removed} removed`);
		if (changed) parts.push(`${changed} changed`);
		if (moved) parts.push(`${moved} moved`);
		return parts.length === 0 ? 'No changes' : parts.join(', ');
	}
</script>

{#snippet spans(ops: DiffOp[])}
	{@html lineHTML(ops)}
{/snippet}

{#snippet marker(row: DiffRow)}
	<span class="marker" aria-hidden="true">{moveMarker(row)}</span>
{/snippet}

{#snippet cells(row: DiffRow)}
	{#if mode === 'side-by-side'}
		{#if show_line_numbers}
			<td class="num" aria-hidden="true" data-line={row.before_line ?? ''}></td>
		{/if}
		<!--
			The label goes in the *first* cell, not the one that changed. A removed
			row's new side is empty, so a label there is announced after the text it
			describes; here it always precedes both sides.
		-->
		<td
			class="text before"
			class:absent={row.before_line === null && row.before_ops.length === 0}>
			{#if rowLabel(row)}<span class="sr">{rowLabel(row)}:</span>{/if}
			<!-- The stub stands where the old document had the span, so its marker
			     belongs to the old column and the span's to the new one. That keeps
			     the two ends on the diagonal a reader's eye already follows. -->
			{#if row.moved_stub}{@render marker(row)}{:else}{@render spans(row.before_ops)}{/if}
		</td>
		{#if show_line_numbers}
			<td class="num" aria-hidden="true" data-line={row.after_line ?? ''}></td>
		{/if}
		<td class="text after" class:absent={row.after_line === null}>
			{#if row.moved_head && !row.moved_stub}{@render marker(row)}{/if}
			{@render spans(row.after_ops)}
		</td>
	{:else}
		{#if show_line_numbers}
			<td class="num" aria-hidden="true" data-line={row.before_line ?? ''}></td>
			<td class="num" aria-hidden="true" data-line={row.after_line ?? ''}></td>
		{/if}
		<td class="text">
			{#if rowLabel(row)}<span class="sr">{rowLabel(row)}:</span>{/if}
			{#if hasMarker(row)}{@render marker(row)}{/if}
			{#if !row.moved_stub}{@render spans(mergeRowOps(row))}{/if}
		</td>
	{/if}
{/snippet}

<!--
	The container is focusable and listens for keys because it is a scrollable
	region with its own shortcuts: WCAG 2.1.1 wants the scroller reachable from
	the keyboard, and `n` / `p` step through the changes once it is. It is a group
	rather than a control — nothing here is activated by pressing it.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={container}
	class={['diff', class_name].filter(Boolean).join(' ')}
	class:wrap
	data-mode={mode}
	{id}
	role="group"
	aria-label="Diff"
	tabindex="0"
	style={max_height ? `--max-height: ${max_height}` : undefined}
	onkeydown={handleKeydown}>
	{#if model.rows.length === 0}
		<p class="empty">There is nothing to compare.</p>
	{:else}
		<table>
			<caption class="sr">
				{summary()}. Press N and P to step through the changes.
			</caption>
			{#if mode === 'side-by-side'}
				<thead>
					<tr>
						{#if show_line_numbers}<th class="num" aria-hidden="true"></th>{/if}
						<th scope="col">{label_before}</th>
						{#if show_line_numbers}<th class="num" aria-hidden="true"></th>{/if}
						<th scope="col">{label_after}</th>
					</tr>
				</thead>
			{/if}
			<tbody>
				{#each model.sections as section, section_index (section_index)}
					{@const first = row_index.get(section.rows[0]) ?? -1}
					{#if section.kind === 'collapsed' && !expanded.has(first)}
						<tr class="gap">
							<td colspan={columns}>
								<button type="button" onclick={() => expand(first)}>
									Show {section.count} unchanged {section.count === 1 ? 'line' : 'lines'}
								</button>
							</td>
						</tr>
					{:else}
						{#each section.rows as row (row_index.get(row))}
							{@const index = row_index.get(row) ?? -1}
							<tr
								data-kind={row.kind}
								data-moved={row.moved ? (row.moved_stub ? 'from' : 'to') : undefined}
								data-moved-stub={row.moved_stub ? '' : undefined}
								data-row={index}
								tabindex={model.changes_set.has(index) ? -1 : undefined}>
								{@render cells(row)}
							</tr>
						{/each}
					{/if}
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	.diff {
		--radius: var(--radius-lg, 10px);
		--insert: var(--color-success, oklch(0.66 0.12 178));
		--delete: var(--color-error, oklch(0.6 0.19 25));
		/*
		 * Tints, not `--color-success-bg` / `--color-error-bg`.
		 *
		 * Those two are mixed against `--color-bg-00` — an opaque colour — so they
		 * only look right on the page's own ground. A diff's tints sit on whatever
		 * surface the host put it on, they sit *inside* each other where an
		 * insertion falls on an inserted line, and they sit under text that has to
		 * stay at 4.5:1. An alpha over the current ground composites correctly in
		 * all three cases; an opaque mix paints the wrong ground in all three.
		 */
		--insert-bg: oklch(from var(--insert) l c h / 0.16);
		--delete-bg: oklch(from var(--delete) l c h / 0.16);
		/*
		 * The third thing this component says, after the insertion green and the
		 * deletion red.
		 *
		 * `@delightstack/styles` has no info hue, so this is derived from the
		 * brand's action colour — but *rotated*, not borrowed. Used raw, a move
		 * is drawn in the same colour as the focus ring, the links and every
		 * other interactive affordance on the page, and a marked-up region of a
		 * document reads as something you can click. Forty degrees is enough to
		 * separate the two at a glance and little enough that the move still
		 * belongs to the brand rather than arriving as a fourth accent. Filed as
		 * DS-16: the styles package should carry a semantic `--color-info` and
		 * components should stop deriving one each.
		 *
		 * Never the only signal: both ends carry the `⇅` glyph and an arrow
		 * pointing at the other end.
		 */
		--moved: oklch(from var(--color-action, oklch(0.55 0.16 255)) l c calc(h + 40));
		/*
		 * The marker's *text*, lifted the way `--color-action-fg` lifts
		 * `--color-action`: `--moved` is a surface colour — a rule, a ground, a
		 * chip — and its lightness sits in the mid band that reads well as a fill
		 * and fails 4.5:1 as small text. Clamped here it measures 5.8:1 on the
		 * chip and 5.0:1 on the stub's row in light, 4.9:1 and 4.9:1 in dark.
		 */
		--moved-fg: light-dark(
			oklch(from var(--moved) min(l, 0.42) c h),
			oklch(from var(--moved) max(l, 0.74) c h)
		);
		--moved-bg: oklch(from var(--moved) l c h / 0.12);
		--gutter: 3.25rem;

		position: relative;
		max-height: var(--max-height, none);
		overflow: auto;
		border: 1px solid var(--color-border, oklch(0.85 0 0));
		border-radius: var(--radius);
		background: var(--color-surface, transparent);
		color: var(--color-text, currentcolor);
		font-family: var(--diff-font, inherit);

		&:focus-visible {
			outline: 2px solid var(--color-action, currentcolor);
			outline-offset: 2px;
		}
	}

	@supports (corner-shape: squircle) {
		.diff {
			corner-shape: squircle;
			border-radius: calc(var(--radius) * 2);
		}
	}

	.empty {
		margin: 0;
		padding: 1.25rem;
		color: var(--color-text-muted, currentcolor);
		text-align: center;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font: inherit;
		text-align: start;
	}

	thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 0.4rem 0.7rem;
		border-bottom: 1px solid var(--color-border, oklch(0.85 0 0));
		background: var(--color-bg-muted, var(--color-surface, transparent));
		color: var(--color-text-muted, currentcolor);
		font-size: 0.8125rem;
		font-weight: 600;
		font-family: var(--font-sans, system-ui, sans-serif);
	}

	/*
	 * The line number is drawn, not written.
	 *
	 * A number in the cell's text content is selected along with the line when
	 * the reader copies a passage out, and read aloud in front of every line by a
	 * screen reader. `content: attr(...)` on an `aria-hidden` cell is neither.
	 */
	.num {
		width: var(--gutter);
		min-width: var(--gutter);
		padding: 0 0.55rem;
		border-inline-end: 1px solid var(--color-border, oklch(0.85 0 0));
		color: var(--color-text-muted, currentcolor);
		font-size: 0.75rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-variant-numeric: tabular-nums;
		text-align: end;
		vertical-align: top;
		user-select: none;

		&::before {
			content: attr(data-line);
		}
	}

	tbody tr {
		&:focus-visible {
			outline: 2px solid var(--color-action, currentcolor);
			outline-offset: -2px;
		}

		&[data-kind='insert'] .text:not(.before) {
			background: var(--insert-bg);
		}

		&[data-kind='delete'] .text:not(.after) {
			background: var(--delete-bg);
		}

		/*
		 * Both ends of a move take a rule down the leading edge, which is what
		 * makes the pair findable by scanning one column. The stub's is dashed:
		 * the text is not here any more, and a solid rule beside an empty line
		 * reads as a line that was emptied.
		 */
		&[data-moved] .text {
			box-shadow: inset 2px 0 0 var(--moved);
		}

		/* `box-shadow` has no logical form, so the inset is mirrored by hand. A
		   border would collapse into the table's own and shift the text 2px. */
		&[data-moved] .text:dir(rtl) {
			box-shadow: inset -2px 0 0 var(--moved);
		}

		&[data-moved='to'] .text:not(.before) {
			background: var(--moved-bg);
		}

		&[data-moved-stub] .text:not(.after) {
			background: var(--moved-bg);
			box-shadow: none;
			border-inline-start: 2px dashed var(--moved);
			padding-inline-start: calc(0.7rem - 2px);
		}
	}

	.text {
		padding: 0.05rem 0.7rem;
		line-height: inherit;
		vertical-align: top;

		&.absent {
			background: var(--color-bg-muted, transparent);
		}

		:global(.line) {
			white-space: pre-wrap;
			overflow-wrap: break-word;
		}
	}

	/*
	 * The move marker: a chip, not a colour.
	 *
	 * Set in the sans face at the small size, so it reads as the component
	 * talking rather than as part of the document — the one thing in a cell that
	 * the writer did not write.
	 */
	.marker {
		display: inline-block;
		margin-inline-end: 0.4rem;
		padding: 0 0.35rem;
		border-radius: 0.25rem;
		background: oklch(from var(--moved) l c h / 0.18);
		color: var(--moved-fg);
		font-size: 0.75rem;
		font-weight: 600;
		font-family: var(--font-sans, system-ui, sans-serif);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		user-select: none;
	}

	@supports (corner-shape: squircle) {
		.marker {
			corner-shape: squircle;
			border-radius: 0.5rem;
		}
	}

	/* The stub is a line of nothing but its marker, and it is not the point of
	   the diff — it says where to look. */
	tbody tr[data-moved-stub] .marker {
		margin-inline-end: 0;
		background: none;
		color: oklch(from var(--moved-fg) l calc(c * 0.7) h / 0.85);
		font-weight: 500;
	}

	.diff:not(.wrap) .text :global(.line) {
		white-space: pre;
	}

	.diff[data-mode='side-by-side'] .before {
		border-inline-end: 1px solid var(--color-border, oklch(0.85 0 0));
	}

	/*
	 * `:global` because the spans come from the diff package's renderer as a
	 * string, so Svelte has no element to hang its scoping attribute on. They are
	 * still confined to this component's cells by the selector.
	 */
	.text :global(:is(ins, del)) {
		text-decoration-thickness: 0.09em;
		text-underline-offset: 0.18em;
	}

	.text :global(ins) {
		background: var(--insert-bg);
		text-decoration-line: underline;
		text-decoration-color: var(--insert);
	}

	.text :global(del) {
		background: var(--delete-bg);
		text-decoration-line: line-through;
		text-decoration-color: var(--delete);
	}

	.gap td {
		padding: 0;
		border-block: 1px solid var(--color-border, oklch(0.85 0 0));
		background: var(--color-bg-muted, transparent);
	}

	.gap button {
		display: block;
		width: 100%;
		padding: 0.3rem 0.7rem;
		border: 0;
		background: none;
		color: var(--color-text-muted, currentcolor);
		font-size: 0.8125rem;
		font-family: var(--font-sans, system-ui, sans-serif);
		text-align: start;
		cursor: pointer;
		/* Colors on the base rule so they fade out; omitted in :hover so they
		   snap in. */
		transition:
			background-color 250ms,
			color 250ms;

		&:hover {
			background: var(--color-bg-active, transparent);
			color: var(--color-text, currentcolor);
			transition: none;
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, currentcolor);
			outline-offset: -2px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.gap button {
			transition: none;
		}
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
