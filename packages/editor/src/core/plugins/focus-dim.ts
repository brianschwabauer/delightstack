import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';

/**
 * ED-07's focus mode: dim everything except the unit of text the caret is in.
 *
 * Decorations only, and deliberately so — focus mode is a fact about one
 * screen, not about the document. Nothing here writes a transaction the host
 * did not dispatch, nothing survives into the serialized document, and two
 * views over the same document can disagree about whether either is focused.
 *
 * The plugin draws two kinds of decoration, both carrying one class
 * (`ds-focus-dim`) the **host styles** — the package ships no opacity because
 * the right dimming is a function of the host's theme:
 *
 * - `Decoration.node` on every block outside the caret's unit, at every depth
 *   between the document and the unit. A node decoration reaches content an
 *   inline decoration cannot — images, rules, code blocks.
 * - `Decoration.inline` inside the caret's own textblock, for the `sentence`
 *   unit, over the text before and after the sentence.
 *
 * ## Cost
 *
 * Recomputed only when the selection or the document changes (or the host
 * changes the mode), and the recomputation is one walk of the caret's
 * ancestors' children plus — for `sentence` — a segmentation of the one
 * textblock the caret is in. A keystroke in a 20,000-word document touches the
 * blocks it can see, not the words it cannot.
 */

/** What stays lit around the caret. */
export type FocusUnit = 'sentence' | 'paragraph' | 'block';

export interface FocusDimOptions {
	/** Start dimmed? Off by default — focus mode is opt-in. */
	enabled?: boolean;
	/** The unit that stays lit. Defaults to `sentence`. */
	unit?: FocusUnit;
	/**
	 * The class every dim decoration carries. One knob rather than a style,
	 * because the right opacity is the host's theme's to answer.
	 */
	class_name?: string;
}

export interface FocusDimState {
	enabled: boolean;
	unit: FocusUnit;
	decorations: DecorationSet;
}

/** What `setFocusDim` may change. Omitted fields keep their value. */
export interface FocusDimPatch {
	enabled?: boolean;
	unit?: FocusUnit;
}

export const focusDimKey = new PluginKey<FocusDimState>('focus-dim');

/** The default decoration class. `ds-`-prefixed like every other plugin's. */
export const FOCUS_DIM_CLASS = 'ds-focus-dim';

/**
 * One segmenter, built on first use. `Intl.Segmenter` with `sentence`
 * granularity is Baseline and dictionary-driven — it knows `e.g.` and `Dr.`
 * are usually not sentence ends, which is as good as sentence detection gets
 * without shipping a model. Built without a locale for the same reason the
 * word counter is: the segmenter's sentence rules are not locale-tailored in
 * ICU, and the plugin does not know the document's language.
 */
let segmenter: Intl.Segmenter | undefined;

function sentenceSegmenter(): Intl.Segmenter | null {
	if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
	segmenter ??= new Intl.Segmenter(undefined, { granularity: 'sentence' });
	return segmenter;
}

/**
 * A trailing token the segmenter wrongly took for a sentence end.
 *
 * ICU's sentence break has no abbreviation suppression list, so `Dr. Smith`
 * arrives as two segments. Best-effort repair, not a model: a segment whose
 * last word is a dotted initialism (`e.g.`, `p.m.`, `J.`) or a title from a
 * short explicit list (`Dr.`, `Mrs.`, `St.`) is merged into the segment after
 * it. The list is deliberate — a shape rule like "any short capitalized word
 * with a period" would swallow every sentence that ends in a name or a month
 * (`…said John. He left.`), and prose ends sentences on those constantly. A
 * real sentence that happens to end in a listed title dims a little
 * generously, which is the cheap side of the error.
 */
const ABBREVIATION_END =
	/(?:^|\s)(?:(?:[A-Za-z]\.)+|(?:Dr|Mr|Mrs|Ms|Prof|Rev|Fr|Sr|Jr|St|Mt|Gen|Col|Sgt|Capt|Lt|Sen|Rep|Hon|vs|cf|ca)\.)\s*$/;

/**
 * Every sentence in `text`, as `[from, to)` offsets, abbreviation-merged.
 *
 * An environment without `Intl.Segmenter` answers with one range over the
 * whole text, which downgrades `sentence` to `paragraph` rather than throwing
 * — dimming the wrong amount is a lesser bug than an editor that cannot open.
 */
export function sentenceRangesIn(text: string): { from: number; to: number }[] {
	if (text.length === 0) return [{ from: 0, to: 0 }];
	const segments = sentenceSegmenter();
	if (!segments) return [{ from: 0, to: text.length }];
	const ranges: { from: number; to: number }[] = [];
	for (const segment of segments.segment(text)) {
		const previous = ranges.at(-1);
		const to = segment.index + segment.segment.length;
		if (previous && ABBREVIATION_END.test(text.slice(previous.from, previous.to))) {
			previous.to = to;
		} else {
			ranges.push({ from: segment.index, to });
		}
	}
	return ranges;
}

/**
 * The sentence around `offset` in `text`, as `[from, to)` offsets.
 *
 * `offset` may equal `text.length` — a caret at the end of the block belongs
 * to the last sentence.
 */
export function sentenceRangeIn(
	text: string,
	offset: number,
): { from: number; to: number } {
	const ranges = sentenceRangesIn(text);
	for (const range of ranges) {
		if (offset >= range.from && offset < range.to) return range;
	}
	// Past the final segment — a caret sitting at the very end of the block.
	return ranges.at(-1) ?? { from: 0, to: text.length };
}

/**
 * A textblock's text with **every leaf holding its width**: an inline atom (a
 * mention, an image) is one position in ProseMirror and must be one character
 * here, or every offset after it names the wrong place. `textContent` drops
 * atoms and is exactly the off-by-n this exists to avoid.
 */
export function textForOffsets(block: PMNode): string {
	return block.textBetween(0, block.content.size, undefined, '￼');
}

/**
 * The dim decorations for a caret at `$head`, with `unit` lit.
 *
 * Exported for tests: the plugin's own `apply` is wiring around this one
 * function, and correctness lives here.
 */
export function focusDimDecorations(
	doc: PMNode,
	$head: ResolvedPos,
	unit: FocusUnit,
	class_name: string = FOCUS_DIM_CLASS,
): Decoration[] {
	const decorations: Decoration[] = [];
	if ($head.depth === 0) return decorations; // A doc-level selection lights everything.

	// `block` lights the caret's top-level block; the other two light the
	// textblock the caret is in (its parent, in every case that matters — a
	// caret is always inside a textblock when depth > 0 in this schema family).
	const lit_depth = unit === 'block' ? 1 : $head.depth;

	// At every depth from the document down to the lit node, dim the lit node's
	// siblings. Whole subtrees dim with one node decoration; nothing below a
	// dimmed block needs visiting, which is what keeps this cheap.
	for (let depth = 1; depth <= lit_depth; depth++) {
		const parent = $head.node(depth - 1);
		const parent_start = depth === 1 ? 0 : $head.start(depth - 1);
		const lit_index = $head.index(depth - 1);
		parent.forEach((child, offset, index) => {
			if (index === lit_index) return;
			const from = parent_start + offset;
			decorations.push(
				Decoration.node(from, from + child.nodeSize, { class: class_name }),
			);
		});
	}

	if (unit === 'sentence' && $head.parent.isTextblock) {
		const block = $head.parent;
		const start = $head.start();
		const text = textForOffsets(block);
		const sentence = sentenceRangeIn(text, $head.parentOffset);
		if (sentence.from > 0) {
			decorations.push(
				Decoration.inline(start, start + sentence.from, { class: class_name }),
			);
		}
		if (sentence.to < block.content.size) {
			decorations.push(
				Decoration.inline(start + sentence.to, start + block.content.size, {
					class: class_name,
				}),
			);
		}
	}

	return decorations;
}

function build(
	doc: PMNode,
	$head: ResolvedPos,
	unit: FocusUnit,
	class_name: string,
): DecorationSet {
	const decorations = focusDimDecorations(doc, $head, unit, class_name);
	return decorations.length
		? DecorationSet.create(doc, decorations)
		: DecorationSet.empty;
}

/**
 * The plugin. Opt-in, like every writing-mode feature — an editor that never
 * calls {@link setFocusDim} pays one plugin-state object and nothing else.
 */
export function focusDim(options: FocusDimOptions = {}): Plugin<FocusDimState> {
	const class_name = options.class_name ?? FOCUS_DIM_CLASS;
	return new Plugin<FocusDimState>({
		key: focusDimKey,
		state: {
			init: (_config, state) => {
				const enabled = options.enabled ?? false;
				const unit = options.unit ?? 'sentence';
				return {
					enabled,
					unit,
					decorations: enabled
						? build(state.doc, state.selection.$head, unit, class_name)
						: DecorationSet.empty,
				};
			},
			apply: (tr, prev) => {
				const meta = tr.getMeta(focusDimKey) as FocusDimPatch | undefined;
				const enabled = meta?.enabled ?? prev.enabled;
				const unit = meta?.unit ?? prev.unit;
				if (!enabled) {
					return prev.decorations === DecorationSet.empty && !meta
						? prev
						: { enabled, unit, decorations: DecorationSet.empty };
				}
				// A transaction that moved neither the document nor the caret — a
				// remote decoration update, a plugin poking its own state — keeps
				// the set it had, mapped through whatever steps there were.
				if (!meta && !tr.docChanged && !tr.selectionSet && prev.enabled) {
					return { enabled, unit, decorations: prev.decorations.map(tr.mapping, tr.doc) };
				}
				return {
					enabled,
					unit,
					decorations: build(tr.doc, tr.selection.$head, unit, class_name),
				};
			},
		},
		props: {
			decorations: (state) => focusDimKey.getState(state)?.decorations,
		},
	});
}

/** The mode a state is in, or `null` where the plugin is not installed. */
export function focusDimStateOf(
	state: EditorState,
): { enabled: boolean; unit: FocusUnit } | null {
	const plugin_state = focusDimKey.getState(state);
	if (!plugin_state) return null;
	return { enabled: plugin_state.enabled, unit: plugin_state.unit };
}

/**
 * Change the mode on a live view. A meta-only transaction: nothing enters the
 * document or its history, which is the property the whole plugin is built
 * around.
 */
export function setFocusDim(view: EditorView, patch: FocusDimPatch): void {
	view.dispatch(view.state.tr.setMeta(focusDimKey, patch));
}
