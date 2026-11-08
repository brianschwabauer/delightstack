<script lang="ts" module>
	export type {
		CorkboardCardLike,
		CorkboardMove,
		ReorderPlan as CorkboardReorderPlan,
	} from './corkboard-model.js';
</script>

<script lang="ts" generics="T extends CorkboardCardLike">
	import { type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import {
		arrowTarget,
		columnCount,
		dropFromPoint,
		dropOnCard,
		planKeyMove,
		planReorder,
		type CorkboardCardLike,
		type CorkboardMove,
		type CorkboardRect,
		type DropIndicator,
		type ReorderPlan,
	} from './corkboard-model.js';
	import {
		applySelection,
		clearSelection,
		fromIDs,
		gestureOf,
		selectAll,
		type SelectionState,
	} from './selection.js';

	const propId = $props.id();

	let {
		/** The cards, in order. Each needs a stable `id`; `droppable` marks one other cards may be dropped onto. */
		cards,

		/** Selected card ids, bindable. Multi-select follows the shared model: `shift`/`mod` click, `shift`+arrows, `mod+a`, `escape`. */
		selected = $bindable([]) as string[],

		/**
		 * The id of the card the keyboard cursor is on, bindable. `null` before
		 * the board is first walked. Selection and cursor are separate, exactly
		 * as they are in `Tree`: arrows move the cursor, `Space` selects.
		 */
		cursor = $bindable(null) as string | null,

		/** Fixed column count. Leave unset for as many columns as fit `min_card_width`. */
		columns = undefined as number | undefined,

		/** Minimum card width in px when `columns` is unset. */
		min_card_width = 220,

		/** Enable drag (and `mod`+arrow) reordering. */
		reorderable = false,

		/** Renders one card's content. */
		card,

		/** Rendered instead of the grid when there are no cards. */
		empty = undefined as Snippet | undefined,

		/** How a card is named to a screen reader (and nothing else). Defaults to its id. */
		label_of = (c: T) => c.id,

		/**
		 * A run of cards was reordered — by drag, or by `mod`+arrow. `ids` are
		 * the moved cards in screen order; `before`/`after` are the ids they
		 * land between (`null` at either end); `index` is where the run lands
		 * once it is removed from the list. The board does not reorder `cards`
		 * itself — commit the change and pass the new order back in.
		 */
		onreorder = undefined as ((detail: ReorderPlan) => void) | undefined,

		/** A card was opened — `Enter`, or a double click. */
		onopen = undefined as ((opened: T) => void) | undefined,

		/** A run of cards was dropped onto a `droppable` card. */
		ondropinto = undefined as
			| ((detail: { ids: string[]; target: T }) => void)
			| undefined,

		/** Accessible name for the board. */
		aria_label = undefined as string | undefined,

		/** The id of the element */
		id = propId,

		/** Specifies a custom class name */
		class: class_name = '',
	}: {
		cards: T[];
		selected?: string[];
		cursor?: string | null;
		columns?: number;
		min_card_width?: number;
		reorderable?: boolean;
		card: Snippet<[T, { selected: boolean; cursor: boolean }]>;
		empty?: Snippet;
		label_of?: (c: T) => string;
		onreorder?: (detail: ReorderPlan) => void;
		onopen?: (opened: T) => void;
		ondropinto?: (detail: { ids: string[]; target: T }) => void;
		aria_label?: string;
		id?: string;
		class?: string;
	} = $props();

	const order = $derived(cards.map((c) => c.id));
	const by_id = $derived(new Map(cards.map((c) => [c.id, c])));

	/* ------------------------------------------------------------------ */
	/* Selection — the shared model, state derived from the bound array   */
	/* ------------------------------------------------------------------ */

	/**
	 * The anchor/lead the pure model needs, kept beside the bound `selected`
	 * array the way `Tree` keeps its own: the array is the public truth, this
	 * is the range bookkeeping. Rebuilt via `fromIDs` when the consumer
	 * assigns `selected` from outside.
	 */
	let selection: SelectionState = { ids: [], anchor: null, lead: null };

	function syncSelection(): SelectionState {
		if (
			selection.ids.length !== selected.length ||
			selection.ids.some((sid, i) => sid !== selected[i])
		) {
			selection = fromIDs(selected, order);
		}
		return selection;
	}

	function commitSelection(next: SelectionState) {
		selection = next;
		selected = next.ids;
	}

	/* ------------------------------------------------------------------ */
	/* Geometry                                                           */
	/* ------------------------------------------------------------------ */

	let grid = $state<HTMLElement | undefined>(undefined);

	/** The laid-out column count, read off the cards when a key needs it. */
	function liveColumns(): number {
		if (columns && columns > 0) return columns;
		if (!grid) return 1;
		const items = Array.from(grid.querySelectorAll<HTMLElement>(':scope > li'));
		return columnCount(items.map((item) => item.offsetTop));
	}

	const cursor_index = $derived(cursor === null ? -1 : order.indexOf(cursor));

	function setCursor(index: number) {
		const next = cards[index];
		if (!next) return;
		cursor = next.id;
		grid
			?.querySelector(`:scope > li[data-card="${CSS.escape(next.id)}"]`)
			?.scrollIntoView({ block: 'nearest' });
	}

	/* ------------------------------------------------------------------ */
	/* Keyboard                                                           */
	/* ------------------------------------------------------------------ */

	const ARROWS: Record<string, CorkboardMove> = {
		ArrowLeft: 'left',
		ArrowRight: 'right',
		ArrowUp: 'up',
		ArrowDown: 'down',
		Home: 'home',
		End: 'end',
	};

	function onKeyDown(event: KeyboardEvent) {
		if (cards.length === 0) return;
		// A card may carry controls of its own — an inline editor, a button.
		// Keys typed into one are that control's, not the board's.
		const target = event.target as HTMLElement | null;
		if (
			target &&
			target !== event.currentTarget &&
			(target.closest('input, textarea, select, [contenteditable="true"]') !== null ||
				(event.key === ' ' && target.closest('button, a') !== null))
		) {
			return;
		}

		const mod = event.metaKey || event.ctrlKey;
		const move = ARROWS[event.key];

		if (move) {
			event.preventDefault();
			const at = cursor_index === -1 ? 0 : cursor_index;
			if (mod && reorderable && onreorder && cursor_index !== -1) {
				// Pick the run up and set it down one step over. The run is the
				// selection when the cursor is in it — moving five scenes is the
				// same gesture as moving one — and the step is measured from the
				// run's edge, which is what keeps it the drag's equal.
				const moving = selected.includes(cursor!) ? selected : [cursor!];
				const plan = planKeyMove(order, moving, move, liveColumns());
				if (plan) onreorder(plan);
				return;
			}
			const next =
				cursor_index === -1 ? 0 : arrowTarget(at, move, liveColumns(), cards.length);
			if (next === -1) return;
			if (event.shiftKey && cursor_index !== -1) {
				// The range follows the cursor in 2D: everything between the anchor
				// and where the cursor lands, in reading order.
				const state = syncSelection();
				const anchor = state.anchor ?? cursor!;
				commitSelection(
					applySelection({ ...state, anchor }, order[next], order, 'range'),
				);
			}
			setCursor(next);
			return;
		}

		if (event.key === 'Enter') {
			const current = cursor === null ? undefined : by_id.get(cursor);
			if (current && !current.disabled && onopen) {
				event.preventDefault();
				onopen(current);
			}
			return;
		}

		if (event.key === ' ') {
			const current = cursor === null ? undefined : by_id.get(cursor);
			if (current && !current.disabled) {
				event.preventDefault();
				commitSelection(applySelection(syncSelection(), current.id, order, 'toggle'));
			}
			return;
		}

		if (mod && (event.key === 'a' || event.key === 'A')) {
			event.preventDefault();
			commitSelection(selectAll(syncSelection(), order));
			return;
		}

		if (event.key === 'Escape' && selected.length > 0) {
			// Selection first; with nothing selected the key is not claimed, so
			// whatever holds the board can take the focus back.
			event.preventDefault();
			event.stopPropagation();
			commitSelection(clearSelection());
			return;
		}
	}

	function onCardClick(clicked: T, event: MouseEvent) {
		if (clicked.disabled) return;
		cursor = clicked.id;
		commitSelection(applySelection(syncSelection(), clicked.id, order, gestureOf(event)));
	}

	/* ------------------------------------------------------------------ */
	/* Drag                                                               */
	/* ------------------------------------------------------------------ */

	let drag_ids = $state<string[]>([]);
	/** Where the drop would land, or null while not dragging over a gap. */
	let drop = $state<DropIndicator | null>(null);
	/** The `droppable` card the drop would land inside, or null. */
	let drop_into = $state<string | null>(null);

	/**
	 * The cards' boxes relative to the grid, measured once at drag start.
	 * The grid does not reflow during a drag — cards move only on drop — so
	 * one measurement serves every `dragover`, and the offsets stay true
	 * under scrolling because they are grid-relative, not viewport-relative.
	 */
	let drag_rects: CorkboardRect[] = [];

	function measureRects(): CorkboardRect[] {
		if (!grid) return [];
		const origin = grid.getBoundingClientRect();
		return Array.from(grid.querySelectorAll<HTMLElement>(':scope > li')).map((item) => {
			const rect = item.getBoundingClientRect();
			return {
				left: rect.left - origin.left,
				top: rect.top - origin.top,
				width: rect.width,
				height: rect.height,
			};
		});
	}

	function onDragStart(dragged: T, event: DragEvent) {
		if (!reorderable || dragged.disabled) {
			event.preventDefault();
			return;
		}
		// The run is the selection when the dragged card is in it.
		const moving = selected.includes(dragged.id)
			? order.filter((oid) => selected.includes(oid))
			: [dragged.id];
		drag_ids = moving;
		drag_rects = measureRects();
		cursor = dragged.id;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', moving.join('\n'));
		}
	}

	function onDragOverCard(over: T, index: number, event: DragEvent) {
		if (drag_ids.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const x = event.clientX - rect.left;
		// The middle half of a droppable card means "into it"; the outer
		// quarters, and every non-droppable card's halves, mean the gap on
		// that side. Tree's thresholds, turned sideways.
		const can_take = Boolean(over.droppable) && ondropinto && !drag_ids.includes(over.id);
		if (can_take && x > rect.width / 4 && x < (rect.width * 3) / 4) {
			drop_into = over.id;
			drop = null;
			return;
		}
		drop_into = null;
		// Anchored on the hovered card itself, so a slot at a row boundary
		// draws on the row the pointer is in — after this row's last card,
		// never before the next row's first.
		drop = dropOnCard(index, x > rect.width / 2, drag_rects);
	}

	function onDragOverGrid(event: DragEvent) {
		if (drag_ids.length === 0 || !grid) return;
		// The grid's own surface: the gaps between cards, between rows, and
		// the ragged tail — a card's dragover has already stopped propagation.
		// The nearest slot is computed from the pointer against the boxes
		// measured at drag start.
		event.preventDefault();
		drop_into = null;
		const origin = grid.getBoundingClientRect();
		drop = dropFromPoint(
			event.clientX - origin.left,
			event.clientY - origin.top,
			drag_rects,
		);
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		event.stopPropagation();
		const moving = drag_ids;
		const into = drop_into;
		const slot = drop?.slot ?? -1;
		clearDrag();
		if (moving.length === 0) return;
		if (into !== null) {
			const target = by_id.get(into);
			if (target && ondropinto) ondropinto({ ids: moving, target });
			return;
		}
		if (slot === -1 || !onreorder) return;
		const plan = planReorder(order, moving, slot);
		if (plan) onreorder(plan);
	}

	function clearDrag() {
		drag_ids = [];
		drag_rects = [];
		drop = null;
		drop_into = null;
	}

	const reduced_motion =
		typeof matchMedia === 'function' &&
		matchMedia('(prefers-reduced-motion: reduce)').matches;
	const FLIP = { duration: reduced_motion ? 0 : 280 };

	const status = $derived.by(() => {
		if (cursor === null) return '';
		const current = by_id.get(cursor);
		if (!current) return '';
		const place = `${order.indexOf(cursor) + 1} of ${cards.length}`;
		const marked = selected.includes(cursor) ? ', selected' : '';
		return `${label_of(current)}, ${place}${marked}`;
	});
</script>

<!-- The plain-list shape for rows that carry controls: the focus holder is the
     board, the cursor is `aria-current`, and every key is handled here — which
     is why the group takes a tabindex and the listeners. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	{id}
	class="corkboard {class_name}"
	class:dragging={drag_ids.length > 0}
	role="group"
	aria-label={aria_label}
	tabindex="0"
	onkeydown={onKeyDown}>
	{#if cards.length === 0}
		{@render empty?.()}
	{:else}
		<ul
			bind:this={grid}
			style:--corkboard-min="{min_card_width}px"
			style:grid-template-columns={columns && columns > 0
				? `repeat(${columns}, minmax(0, 1fr))`
				: undefined}
			ondragover={onDragOverGrid}
			ondrop={onDrop}
			ondragend={clearDrag}>
			{#each cards as item, index (item.id)}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
				<li
					data-card={item.id}
					animate:flip={FLIP}
					class:cursor={cursor === item.id}
					class:selected={selected.includes(item.id)}
					class:dragged={drag_ids.includes(item.id)}
					class:drop-before={drop?.index === index && drop.edge === 'before'}
					class:drop-after={drop?.index === index && drop.edge === 'after'}
					class:drop-outer={drop?.index === index && drop.outer}
					class:drop-into={drop_into === item.id}
					aria-current={cursor === item.id ? 'true' : undefined}
					draggable={reorderable && !item.disabled ? 'true' : undefined}
					ondragstart={(e) => onDragStart(item, e)}
					ondragover={(e) => onDragOverCard(item, index, e)}
					ondrop={onDrop}
					ondragend={clearDrag}
					onclick={(e) => onCardClick(item, e)}
					ondblclick={() => !item.disabled && onopen?.(item)}>
					{@render card(item, {
						selected: selected.includes(item.id),
						cursor: cursor === item.id,
					})}
				</li>
			{/each}
		</ul>
	{/if}
	<span class="visually-hidden" role="status">{status}</span>
</div>

<style>
	.corkboard {
		display: block;

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: 2px;
			border-radius: 4px;
		}
	}

	ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(var(--corkboard-min, 220px), 1fr));
		gap: var(--corkboard-gap, 0.75rem);
		margin: 0;
		padding: 0;
		list-style: none;
		align-items: stretch;
	}

	li {
		--_radius: var(--corkboard-radius, 8px);
		position: relative;
		border-radius: var(--_radius);
		transition: background-color 250ms;

		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--_radius) * 2);
		}

		&.cursor {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: 2px;
		}

		&.selected {
			background-color: light-dark(
				rgb(from var(--color-action, #1976d2) r g b / 0.1),
				rgb(from var(--color-action, #5c9ce6) r g b / 0.16)
			);
		}

		&.dragged {
			opacity: 0.4;
		}

		/* The gap the drop would land in, drawn as a bar down the card's edge —
		   centred in the grid gap so it reads as *between*, not *on*. */
		&.drop-before::after,
		&.drop-after::after {
			content: '';
			position: absolute;
			inset-block: 0;
			inline-size: 2px;
			border-radius: 1px;
			background: var(--color-action, #1976d2);
			z-index: 1;
		}

		&.drop-before::after {
			inset-inline-start: calc(-0.5 * var(--corkboard-gap, 0.75rem) - 1px);
		}

		&.drop-after::after {
			inset-inline-end: calc(-0.5 * var(--corkboard-gap, 0.75rem) - 1px);
		}

		/* At the grid's own boundary there is no gap to centre in — half a gap
		   to the side hangs outside the grid, where a scrolling ancestor's
		   overflow clips it — so the bar draws flush inside the card's edge. */
		&.drop-outer.drop-before::after {
			inset-inline-start: 0;
		}

		&.drop-outer.drop-after::after {
			inset-inline-end: 0;
		}

		&.drop-into {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: -2px;
			background: light-dark(
				rgb(from var(--color-action, #1976d2) r g b / 0.08),
				rgb(from var(--color-action, #5c9ce6) r g b / 0.12)
			);
		}
	}

	.corkboard.dragging,
	.corkboard.dragging li {
		cursor: grabbing;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		li {
			transition: none;
		}
	}
</style>
