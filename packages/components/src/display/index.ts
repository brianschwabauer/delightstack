export { default as Accordion, AccordionItem } from './Accordion.svelte';
export { default as Avatar } from './Avatar.svelte';
export { default as AvatarGroup } from './AvatarGroup.svelte';
export type { AvatarData } from './AvatarGroup.svelte';
export { default as Calendar } from './Calendar.svelte';
export { default as Chart } from './Chart.svelte';
export type { ChartData, Dataset as ChartDataset } from './Chart.svelte';
export type { CalendarEvent, MarkedDate } from './Calendar.svelte';
// `Code` is deliberately NOT re-exported here — Corkboard's stance, applied
// retroactively (DS-13 in DelightWrite's docs/14): its tokenizer's top-level
// tables defeat purity analysis, so a barrel edge to it puts ~3KB gzipped into
// whatever chunk eagerly imports `./display`, used or not. Name the file
// export: `@delightstack/components/display/Code.svelte`.
// `tokenizeLine` is deliberately NOT value-re-exported here — Corkboard's
// stance, one module deeper (DS-13 in DelightWrite's docs/14): the tokenizer's
// top-level tables defeat purity analysis, so the moment any consumer uses
// `Code`, a barrel edge to it drags ~3KB gzipped into whatever chunk eagerly
// imports `./display`. Name it by its file export:
// `@delightstack/components/display/code-tokens`.
export type { Token as CodeToken } from './code-tokens.js';
export { default as Comparison } from './Comparison.svelte';
// `Corkboard` is deliberately NOT re-exported here. Without a `sideEffects`
// declaration a barrel's modules ride in whatever chunk imports the barrel
// (DS-13 in DelightWrite's docs/14, measured): every consumer whose shell
// eagerly imports `./display` for `SplitPane` or `Tree` would ship the whole
// board in its boot payload whether or not anything renders one. A corkboard
// is a view-level component, so it gets the per-component export path DS-13
// asks for, from birth: `@delightstack/components/display/Corkboard.svelte`
// and `…/display/corkboard-model`.
export { default as Counter } from './Counter.svelte';
export { default as DiffViewer } from './DiffViewer.svelte';
export {
	buildDiffModel,
	hunksFromText,
	mergeRowOps,
	nextChange as nextDiffChange,
	previousChange as previousDiffChange,
	sectionize as sectionizeDiff,
	tokenizeGraphemes,
	type BuildDiffModelOptions,
	type DiffGranularity,
	type DiffHunk,
	type DiffHunkKind,
	type DiffModel,
	type DiffRow,
	type DiffSection,
	type DiffStats,
} from './diff-model.js';
export { default as Expand } from './Expand.svelte';
export { default as List } from './List.svelte';
export { default as ListItem } from './ListItem.svelte';
export { default as QR } from './QR.svelte';
export {
	applySelection,
	clearSelection,
	EMPTY_SELECTION,
	extendSelection,
	fromIDs as selectionFromIDs,
	gestureOf as selectionGestureOf,
	selectAll as selectionSelectAll,
	type SelectionGesture,
	type SelectionModifiers,
	type SelectionState,
} from './selection.js';
export { default as SplitPane } from './SplitPane.svelte';
export { default as Stat } from './Stat.svelte';
export { default as Table } from './Table.svelte';
export type {
	Column as TableColumn,
	PaginationConfig as TablePaginationConfig,
	VirtualScroll,
	VirtualScrollOptions,
	VirtualScroller,
	CellOption as TableCellOption,
	CellEditContext as TableCellEditContext,
	CellEditorContext as TableCellEditorContext,
	CellAutocompleteContext as TableCellAutocompleteContext,
	CellEditorType as TableCellEditorType,
} from './Table.svelte';
export { default as Timeline, TimelineItem } from './Timeline.svelte';
export { default as Tree } from './Tree.svelte';
export type { TreeNode, FlatTreeNode } from './Tree.svelte';
export { default as Typewriter } from './Typewriter.svelte';
