<script lang="ts" generics="T extends Record<string, unknown>">
	/**
	 * The single inline editor mounted in a Table's currently-active cell. The
	 * Table mounts exactly one of these (keyed by cell identity) and owns active-cell
	 * movement; this component owns the editor control, the autocomplete popover, and
	 * inline validation. It emits navigation intents upward — it never moves the
	 * active cell itself.
	 *
	 * Autocomplete mirrors the Input component: a native `popover="manual"` placed
	 * with CSS anchor positioning (top layer → escapes the row's `overflow: hidden`),
	 * arrow/Enter/Escape keys, 300ms debounce for async results, and a loading row.
	 */
	import type { Column, CellOption, CellEditorContext } from './Table.svelte';
	import { onMount, onDestroy, tick } from 'svelte';
	import List from './List.svelte';
	import ListItem from './ListItem.svelte';

	let {
		column,
		row,
		index,
		value,
		/** Save-error message from the Table (a rejected async `onedit`), shown inline. */
		errorMessage = undefined,
		dense = false,
		comfortable = false,
		/** Whether this cell is the first / last navigable cell — lets Tab fall out of
		 * the grid at the edges instead of trapping focus. */
		isFirstCell = false,
		isLastCell = false,
		/** Value changed and passed validation — the Table runs `onedit`. */
		oncommit = undefined,
		/** Move the active cell. The Table has already let us commit. */
		onnavigate = undefined,
		/** Focus left the grid (blur / click-away) — the Table clears the active cell. */
		onexit = undefined,
		/** Per-keystroke notification — the Table fires `column.oninput`. */
		onliveinput = undefined,
	}: {
		column: Column<T>;
		row: T;
		index: number;
		value: unknown;
		errorMessage?: string | undefined;
		dense?: boolean;
		comfortable?: boolean;
		isFirstCell?: boolean;
		isLastCell?: boolean;
		oncommit?: (detail: { value: unknown }) => void;
		onnavigate?: (detail: {
			dir: 'up' | 'down' | 'left' | 'right' | 'next' | 'prev';
		}) => void;
		onexit?: () => void;
		onliveinput?: (detail: { value: unknown }) => void;
	} = $props();

	const uid = $props.id();
	const anchorName = `--ds-cell-${String(uid).replace(/[^a-zA-Z0-9_-]/g, '')}`;

	// ---- Editor kind ----
	const customEditor = $derived(
		typeof column.editor === 'function' ? column.editor : undefined,
	);
	const editorType = $derived(typeof column.editor === 'string' ? column.editor : 'text');
	const isBoolean = $derived(editorType === 'boolean' && !customEditor);
	const isSelect = $derived(editorType === 'select' && !customEditor);
	const isNumber = $derived(editorType === 'number' && !customEditor);
	const isDate = $derived(editorType === 'date' && !customEditor);

	// ---- Value helpers ----
	function formatValue(v: unknown): string {
		if (column.format) return column.format(v, row);
		return v == null ? '' : String(v);
	}
	function parseValue(raw: string): unknown {
		if (column.parse) return column.parse(raw, row);
		if (isNumber) {
			const t = raw.trim();
			if (t === '') return null;
			return Number(t);
		}
		return raw;
	}

	// `column` is fixed for this editor's life (it remounts per cell via {#key}), so
	// the initial editor kind is a plain (non-reactive) read.
	const startsBoolean = typeof column.editor === 'string' && column.editor === 'boolean';
	const initialText = formatValue(value);
	const initialBool = !!value;

	// ---- Local state ----
	let draft = $state<string | boolean>(startsBoolean ? initialBool : initialText);
	let localError = $state<string | null>(null);
	let committed = false; // synchronous guard against double-commit on exit/destroy
	let inputEl = $state<HTMLInputElement | undefined>(undefined);
	let boolEl = $state<HTMLButtonElement | undefined>(undefined);
	let rootEl = $state<HTMLDivElement | undefined>(undefined);

	// ---- Autocomplete state (mirrors Input.svelte) ----
	let ac_open = $state(false);
	let ac_highlighted = $state(-1);
	let ac_loading = $state(false);
	let ac_filtered = $state<CellOption[]>([]);
	let ac_above = $state(false);
	let ac_debounce: ReturnType<typeof setTimeout> | undefined;
	let dropdownEl = $state<HTMLElement | undefined>(undefined);
	let selectedOption: CellOption | null = null;

	const hasStaticOptions = $derived(!!(column.options && column.options.length));
	const hasAutocomplete = $derived(
		!isBoolean &&
			!customEditor &&
			(hasStaticOptions || !!column.onautocomplete || isSelect),
	);

	function normalizeOptions(opts: CellOption[] | string[] | undefined): CellOption[] {
		if (!opts) return [];
		return opts.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
	}

	const ac_options = $derived.by((): CellOption[] => {
		if (column.onautocomplete) return ac_filtered;
		const opts = normalizeOptions(column.options as CellOption[] | string[] | undefined);
		// A `select` always shows the full option list (typing jumps the highlight,
		// it doesn't filter). Plain autocomplete filters by the current value.
		if (isSelect) return opts;
		const q = typeof draft === 'string' ? draft.trim().toLowerCase() : '';
		if (!q) return opts;
		return opts.filter((o) => (o.label ?? o.value).toLowerCase().includes(q));
	});

	// Mirror `ac_open` onto the native popover, and detect a flip-above so the panel
	// expands from the edge nearest the cell (same technique as Input).
	$effect(() => {
		const el = dropdownEl;
		if (!el) return;
		const shown = el.matches(':popover-open');
		if (ac_open && !shown) {
			try {
				el.showPopover();
				if (rootEl) {
					const t = rootEl.getBoundingClientRect();
					const d = el.getBoundingClientRect();
					ac_above = d.top < t.top;
				}
			} catch {
				/* not connected yet */
			}
		} else if (!ac_open && shown) {
			try {
				el.hidePopover();
			} catch {
				/* already hidden */
			}
		}
	});

	// When the panel opens, park the highlight: a `select` starts on its current
	// value (so arrows step from there); autocomplete starts on the first match (so
	// Enter picks the top result without arrowing). Reads `ac_open`/`ac_options`
	// only — not `ac_highlighted` — so arrow moves never re-trigger it.
	$effect(() => {
		const opts = ac_options;
		if (!ac_open) return;
		if (isSelect) {
			const cur = opts.findIndex(
				(o) => (o.label ?? o.value) === initialText || o.value === initialText,
			);
			ac_highlighted = cur >= 0 ? cur : opts.findIndex((o) => !o.disabled);
		} else {
			ac_highlighted = opts.findIndex((o) => !o.disabled);
		}
	});

	// Pull the option <button>s (ListItem) out of the tab order so focus stays in the
	// input; clicks still work (their pointerdown is prevented on the panel).
	$effect(() => {
		if (!dropdownEl || ac_options.length === 0) return;
		dropdownEl.querySelectorAll('button').forEach((b) => (b.tabIndex = -1));
	});

	function openAutocomplete() {
		if (!hasAutocomplete) return;
		ac_open = true;
		if (column.onautocomplete) filterAutocomplete(typeof draft === 'string' ? draft : '');
	}
	function closeAutocomplete() {
		ac_open = false;
		ac_highlighted = -1;
	}
	async function filterAutocomplete(query: string) {
		if (!column.onautocomplete) return;
		ac_loading = true;
		try {
			const r = await column.onautocomplete({
				query,
				value: parseValue(query),
				row,
				index,
				column,
			});
			ac_filtered = normalizeOptions(r);
		} finally {
			ac_loading = false;
		}
	}
	function moveHighlight(delta: number) {
		const opts = ac_options;
		if (!opts.length) return;
		let i = ac_highlighted;
		for (let n = 0; n < opts.length; n++) {
			i = (i + delta + opts.length) % opts.length;
			if (!opts[i].disabled) break;
		}
		ac_highlighted = i;
		requestAnimationFrame(() => {
			const items = dropdownEl?.querySelectorAll('.list-item');
			items?.[ac_highlighted]?.scrollIntoView({ block: 'nearest' });
		});
	}

	function highlightMatch(text: string): string {
		const q = typeof draft === 'string' ? draft.trim() : '';
		if (!q) return escapeHtml(text);
		const idx = text.toLowerCase().indexOf(q.toLowerCase());
		if (idx === -1) return escapeHtml(text);
		return `${escapeHtml(text.slice(0, idx))}<strong>${escapeHtml(
			text.slice(idx, idx + q.length),
		)}</strong>${escapeHtml(text.slice(idx + q.length))}`;
	}
	function escapeHtml(s: string): string {
		return s.replace(/[&<>"']/g, (c) =>
			c === '&'
				? '&amp;'
				: c === '<'
					? '&lt;'
					: c === '>'
						? '&gt;'
						: c === '"'
							? '&quot;'
							: '&#39;',
		);
	}

	// ---- Validation ----
	async function runValidate(parsed: unknown): Promise<string | null> {
		if (isNumber && typeof parsed === 'number' && Number.isNaN(parsed)) {
			return 'Enter a valid number';
		}
		if (column.validate) {
			const r = await column.validate(parsed, row, index);
			return r && r.length ? r : null;
		}
		return null;
	}

	// ---- Commit ----
	async function tryCommit(): Promise<boolean> {
		if (committed || isBoolean) return true;
		const text = String(draft);
		if (isSelect && !optionFor(text)) {
			// Constrained: an unmatched value reverts rather than commits.
			draft = initialText;
			committed = true;
			return true;
		}
		if (text === initialText) {
			committed = true;
			return true;
		}
		committed = true; // synchronous guard
		const parsed =
			selectedOption && (selectedOption.label ?? selectedOption.value) === text
				? selectedOption.value
				: parseValue(text);
		const err = await runValidate(parsed);
		if (err) {
			committed = false;
			localError = err;
			return false;
		}
		oncommit?.({ value: parsed });
		return true;
	}

	function optionFor(text: string): CellOption | undefined {
		const opts = column.onautocomplete
			? ac_filtered
			: normalizeOptions(column.options as never);
		return opts.find((o) => (o.label ?? o.value) === text || o.value === text);
	}

	async function commitAndNavigate(
		dir: 'up' | 'down' | 'left' | 'right' | 'next' | 'prev',
	) {
		const ok = await tryCommit();
		if (ok) onnavigate?.({ dir });
	}

	function selectOption(opt: CellOption) {
		if (opt.disabled) return;
		selectedOption = opt;
		draft = opt.label ?? opt.value;
		localError = null;
		closeAutocomplete();
		committed = false;
		void commitAndNavigate('down');
	}

	function toggleBoolean() {
		draft = !(draft as boolean);
		oncommit?.({ value: draft });
	}

	function cancel() {
		if (ac_open) {
			closeAutocomplete();
			return;
		}
		draft = isBoolean ? initialBool : initialText;
		localError = null;
		selectedOption = null;
	}

	// ---- Caret edge detection (for ←/→ cell jumps) ----
	function caretAtStart(): boolean {
		const el = inputEl;
		if (!el) return true;
		try {
			return el.selectionStart === 0 && el.selectionEnd === 0;
		} catch {
			return true; // inputs without text selection (number/date) jump freely
		}
	}
	function caretAtEnd(): boolean {
		const el = inputEl;
		if (!el) return true;
		try {
			return el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
		} catch {
			return true;
		}
	}

	// ---- Keyboard ----
	function handleKeydown(e: KeyboardEvent) {
		if (e.isComposing || e.keyCode === 229) return; // IME composition
		const k = e.key;

		// Autocomplete navigation takes priority while the panel is open.
		if (ac_open && ac_options.length) {
			if (k === 'ArrowDown') {
				e.preventDefault();
				moveHighlight(1);
				return;
			}
			if (k === 'ArrowUp') {
				e.preventDefault();
				moveHighlight(-1);
				return;
			}
			if (k === 'Enter' && ac_highlighted >= 0) {
				e.preventDefault();
				selectOption(ac_options[ac_highlighted]);
				return;
			}
			if (k === 'Escape') {
				e.preventDefault();
				closeAutocomplete();
				return;
			}
		}

		switch (k) {
			case 'Enter':
				e.preventDefault();
				void commitAndNavigate('down');
				break;
			case 'Tab':
				if ((!e.shiftKey && isLastCell) || (e.shiftKey && isFirstCell)) {
					void tryCommit(); // let focus fall out of the grid
					return;
				}
				e.preventDefault();
				void commitAndNavigate(e.shiftKey ? 'prev' : 'next');
				break;
			case 'Escape':
				e.preventDefault();
				cancel();
				break;
			case 'ArrowUp':
				e.preventDefault();
				void commitAndNavigate('up');
				break;
			case 'ArrowDown':
				e.preventDefault();
				void commitAndNavigate('down');
				break;
			case 'ArrowLeft':
				if (caretAtStart()) {
					e.preventDefault();
					void commitAndNavigate('left');
				}
				break;
			case 'ArrowRight':
				if (caretAtEnd()) {
					e.preventDefault();
					void commitAndNavigate('right');
				}
				break;
		}
	}

	function handleBooleanKeydown(e: KeyboardEvent) {
		if (e.isComposing) return;
		switch (e.key) {
			case ' ':
				e.preventDefault();
				toggleBoolean();
				break;
			case 'Enter':
				e.preventDefault();
				toggleBoolean();
				onnavigate?.({ dir: 'down' });
				break;
			case 'Tab':
				if ((!e.shiftKey && isLastCell) || (e.shiftKey && isFirstCell)) return;
				e.preventDefault();
				onnavigate?.({ dir: e.shiftKey ? 'prev' : 'next' });
				break;
			case 'ArrowUp':
				e.preventDefault();
				onnavigate?.({ dir: 'up' });
				break;
			case 'ArrowDown':
				e.preventDefault();
				onnavigate?.({ dir: 'down' });
				break;
			case 'ArrowLeft':
				e.preventDefault();
				onnavigate?.({ dir: 'left' });
				break;
			case 'ArrowRight':
				e.preventDefault();
				onnavigate?.({ dir: 'right' });
				break;
		}
	}

	function handleInput() {
		localError = null;
		selectedOption = null;
		onliveinput?.({ value: isNumber ? parseValue(String(draft)) : draft });
		if (!hasAutocomplete) return;
		ac_open = true;
		if (isSelect) {
			// Type-ahead: jump the highlight to the first option that starts with what
			// was typed; the list itself stays unfiltered.
			const q = String(draft).trim().toLowerCase();
			if (q) {
				const i = ac_options.findIndex(
					(o) => !o.disabled && (o.label ?? o.value).toLowerCase().startsWith(q),
				);
				if (i >= 0) ac_highlighted = i;
			}
			return;
		}
		if (column.onautocomplete) {
			clearTimeout(ac_debounce);
			const q = String(draft);
			ac_debounce = setTimeout(() => filterAutocomplete(q), 300);
		}
	}

	// Real blur (focus left the editor + popover) → commit and exit edit mode.
	function handleFocusOut(e: FocusEvent) {
		const next = e.relatedTarget as Node | null;
		if (next && (rootEl?.contains(next) || dropdownEl?.contains(next))) return;
		closeAutocomplete();
		void tryCommit();
		onexit?.();
	}

	// ---- Lifecycle: autofocus + select on mount; commit a dirty draft if torn down
	// (e.g. the row scrolled out of a virtual window) before an explicit commit. ----
	onMount(() => {
		void (async () => {
			await tick();
			if (isBoolean) {
				boolEl?.focus();
			} else {
				inputEl?.focus();
				try {
					inputEl?.select();
				} catch {
					/* noop */
				}
				if (hasAutocomplete) openAutocomplete();
			}
		})();
	});

	onDestroy(() => {
		clearTimeout(ac_debounce);
		if (!committed && !isBoolean) void tryCommit();
	});

	const editorCtx = $derived<CellEditorContext<T>>({
		value,
		row,
		index,
		column,
		setValue: (v: unknown) => {
			draft = (isBoolean ? !!v : String(v ?? '')) as typeof draft;
		},
		commit: () => void commitAndNavigate('down'),
		cancel,
	});

	const showError = $derived(localError ?? errorMessage ?? null);
	const placeholder = $derived(column.placeholder ?? '');
</script>

{#snippet checkmark(checked: boolean)}
	<span class="ds-checkmark" class:checked>
		<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
			<rect class="box" x="2" y="2" width="20" height="20" rx="3" stroke-width="2" />
			<path
				class="check"
				d="M6 12.5 L10 16.5 L18 8"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round" />
		</svg>
	</span>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="cell-editor"
	class:has-error={!!showError}
	class:dense
	class:comfortable
	class:is-bool={isBoolean}
	bind:this={rootEl}
	style:anchor-name={anchorName}
	onfocusout={handleFocusOut}>
	{#if customEditor}
		{@render customEditor(editorCtx)}
	{:else if isBoolean}
		<button
			type="button"
			class="bool-toggle"
			role="switch"
			aria-checked={draft as boolean}
			aria-label={column.label}
			bind:this={boolEl}
			onclick={(e) => {
				e.stopPropagation();
				toggleBoolean();
			}}
			onkeydown={handleBooleanKeydown}>
			{@render checkmark(draft as boolean)}
		</button>
	{:else}
		<input
			class="cell-input"
			type={isDate ? 'date' : 'text'}
			inputmode={isNumber ? 'decimal' : undefined}
			role={hasAutocomplete ? 'combobox' : undefined}
			aria-expanded={hasAutocomplete ? ac_open : undefined}
			aria-controls={hasAutocomplete ? `${uid}-cell-listbox` : undefined}
			aria-autocomplete={hasAutocomplete ? 'list' : undefined}
			aria-invalid={!!showError}
			{placeholder}
			bind:this={inputEl}
			bind:value={draft}
			oninput={handleInput}
			onkeydown={handleKeydown} />
	{/if}

	{#if hasAutocomplete}
		<!-- Autocomplete popover — native popover + CSS anchor positioning (top layer).
		     Uses List/ListItem; ListItem's active highlight snaps in instantly (see
		     ListItem's `.active` ::before rule), so arrowing feels immediate. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="ac-dropdown"
			class:above={ac_above}
			popover="manual"
			bind:this={dropdownEl}
			role="listbox"
			id="{uid}-cell-listbox"
			style:position-anchor={anchorName}
			onpointerdown={(e) => e.preventDefault()}>
			{#if ac_loading}
				<div class="ac-status">
					<span class="ac-spinner" aria-hidden="true"></span>
					Loading…
				</div>
			{:else if ac_options.length === 0}
				<div class="ac-status">No results</div>
			{:else}
				<List dense>
					{#each ac_options as opt, i (opt.value)}
						<ListItem
							active={ac_highlighted === i}
							disabled={opt.disabled}
							onclick={() => selectOption(opt)}>
							<span class="ac-option">
								<span class="ac-option-label">
									{@html highlightMatch(opt.label ?? opt.value)}
								</span>
								{#if opt.description}
									<span class="ac-option-desc">{opt.description}</span>
								{/if}
							</span>
						</ListItem>
					{/each}
				</List>
			{/if}
		</div>
	{/if}

	{#if showError}
		<!-- Error tooltip as a top-layer popover so it can't be hidden behind the cells
		     stacked below it. -->
		<div
			class="cell-editor-error"
			popover="manual"
			role="alert"
			style:position-anchor={anchorName}
			{@attach (node) => {
				try {
					(node as HTMLElement & { showPopover(): void }).showPopover();
				} catch {
					/* not connected */
				}
			}}>
			{showError}
		</div>
	{/if}
</div>

<style>
	.cell-editor {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		/* Bleed to the cell edges (the td keeps its padding for the resting text; the
		   editor cancels it so the caret sits where the display text was). */
		margin: -0.75rem -1rem;
		padding: 0.75rem 1rem;
		gap: 0.5rem;
	}
	.cell-editor.dense {
		margin: -0.375rem -0.75rem;
		padding: 0.375rem 0.75rem;
	}
	.cell-editor.comfortable {
		margin: -1rem -1.25rem;
		padding: 1rem 1.25rem;
	}

	.cell-input {
		flex: 1;
		min-width: 0;
		width: 100%;
		border: none;
		outline: none;
		background: transparent;
		padding: 0;
		margin: 0;
		font: inherit;
		color: inherit;
		line-height: inherit;
	}
	.cell-input::placeholder {
		color: light-dark(var(--color-text-muted, #9ca3af), var(--color-text-muted, #6b7280));
	}

	.cell-editor.has-error .cell-input {
		color: var(--color-error, #dc2626);
	}

	/* Error tooltip — a top-layer popover (CSS anchor positioned) so it paints over
	   the cells below it, never behind them. */
	.cell-editor-error {
		position: fixed;
		top: anchor(bottom);
		left: anchor(left);
		margin: 4px 0 0 0;
		padding: 0.3em 0.55em;
		border: none;
		font-size: 0.75rem;
		white-space: nowrap;
		color: #fff;
		background: var(--color-error, #dc2626);
		border-radius: var(--radius-md, 6px);
		box-shadow: var(--shadow-md, 0 8px 28px -8px rgb(0 0 0 / 0.35));
		pointer-events: none;
		position-try-fallbacks: flip-block;
	}

	/* ---- Boolean toggle: fills the whole cell so a click anywhere toggles ---- */
	/* `position: static` lets the button's `inset: 0` resolve to the <td> (which is
	   `position: relative`), so the toggle covers the entire cell including padding. */
	.cell-editor.is-bool {
		position: static;
		margin: 0;
		padding: 0;
	}
	.bool-toggle {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}
	.bool-toggle:focus-visible {
		outline: none;
	}

	/* Checkbox visual — matches the Checkbox component (accent-filled box + drawn
	   check), so editable boolean cells read identically to a real Checkbox. */
	.ds-checkmark {
		display: inline-flex;
		flex-shrink: 0;
		line-height: 0;
	}
	.ds-checkmark .box {
		stroke: light-dark(
			var(--color-text-disabled, #999),
			var(--color-text-disabled, #777)
		);
		fill: transparent;
		transition:
			stroke 150ms ease,
			fill 150ms ease;
	}
	.ds-checkmark .check {
		stroke: transparent;
		fill: none;
		stroke-dasharray: 28;
		stroke-dashoffset: 28;
		transition:
			stroke-dashoffset 250ms ease,
			stroke 150ms ease;
	}
	.ds-checkmark.checked .box {
		stroke: var(--color-accent, #1976d2);
		fill: var(--color-accent, #1976d2);
	}
	.ds-checkmark.checked .check {
		stroke: var(--color-accent-text, #fff);
		stroke-dashoffset: 0;
	}

	/* ================================================================== */
	/*  Autocomplete popover — mirrors Input.svelte's .ac-dropdown        */
	/* ================================================================== */
	.ac-dropdown {
		position: fixed;
		top: anchor(bottom);
		bottom: auto;
		left: anchor(left);
		right: auto;
		width: max(anchor-size(width), 12rem);
		margin: 0.35em 0 0 0;
		padding: 0.25em;
		box-sizing: border-box;
		max-height: 16em;
		overflow-y: auto;
		/* Border + shadow together: in light mode the shadow lifts the panel and
		   the border is a faint edge; in dark mode --shadow-md is transparent, so
		   the border is what separates the panel from the page. */
		border: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #404040));
		background: light-dark(var(--color-bg, #fff), var(--color-surface, #262626));
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		border-radius: var(--radius-xl, 16px);
		box-shadow: var(--shadow-md, 0 8px 28px -8px rgb(0 0 0 / 0.3));
		scrollbar-width: thin;
		position-try-fallbacks: flip-block;
		transform-origin: center top;
		opacity: 1;
		transform: scaleY(1);
		transition:
			opacity 200ms cubic-bezier(0.16, 1, 0.3, 1),
			transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
			display 200ms allow-discrete,
			overlay 200ms allow-discrete;
	}
	.ac-dropdown.above {
		transform-origin: center bottom;
	}
	.ac-dropdown:not(:popover-open) {
		opacity: 0;
		transform: scaleY(0.6);
	}
	@starting-style {
		.ac-dropdown:popover-open {
			opacity: 0;
			transform: scaleY(0.6);
		}
	}

	.ac-option {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		text-align: left;
	}
	.ac-option-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ac-option-label :global(strong) {
		color: var(--color-action, #1976d2);
		font-weight: 700;
	}
	.ac-option-desc {
		font-size: 0.8em;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ac-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		padding: 0.85em;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		font-size: 0.9em;
	}
	.ac-spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #404040));
		border-top-color: var(--color-action, #1976d2);
		border-radius: 50%;
		animation: cell-ac-spin 0.6s linear infinite;
		flex-shrink: 0;
	}
	@keyframes cell-ac-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ac-dropdown {
			transition: none;
		}
		.ac-spinner {
			animation-duration: 1.2s;
		}
	}
</style>
