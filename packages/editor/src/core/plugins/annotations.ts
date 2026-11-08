import { Plugin, PluginKey, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import {
	createAnchorCache,
	resolveAnchors,
	type AnchorCache,
	type AnchorStaleReason,
	type TextAnchor,
} from './anchors.js';

/**
 * ED-06 — annotation decorations for externally-owned highlights and notes.
 *
 * **An annotation is not a mark, and that is the whole design.** The obvious
 * implementation is a schema mark carrying an id — and it is wrong here for a
 * reason that has nothing to do with ProseMirror: a mark lives in the document,
 * so highlighting somebody else's article would be an *edit* to it, in the
 * document's history, syncing to every device, dirtying a body a reader never
 * meant to touch. A highlight is a thing you did; it is not a thing the text
 * says. So an annotation is a row in the host's own table and this plugin draws
 * it as a decoration, exactly the way ED-08 draws a suggestion, and for the same
 * reason.
 *
 * That decision is also what makes the anchoring inevitable. A row cannot hold a
 * position — the document moves and the row does not — so an annotation is
 * addressed by `{block_id, quote, prefix, suffix}` and re-found on every
 * document change by the shared core in `anchors.ts`. Edit around a highlight
 * and it follows its sentence; delete the sentence and it goes **stale**, which
 * is reported and never dropped: the quote is still in the row, and a reader who
 * highlighted a paragraph that has since been rewritten is owed the sentence
 * they kept, not silence.
 *
 * **This plugin never writes to the document, and never owns the data.** It
 * draws what the host hands it and calls back when the user picks one. Creating,
 * recolouring, annotating and deleting are all the host's — they are row writes,
 * and a decoration plugin with an opinion about a database is a decoration
 * plugin nobody can reuse.
 */

/** One highlight. Mirrors the host's row; the plugin stores none of it. */
export interface Annotation {
	/** The host's row id. Identity for callbacks, focus and keying. */
	id: string;
	/** The highlighted text, exactly as it read when it was highlighted. */
	quote: string;
	/** Block it was made against, if the host recorded one. A hint, not an address. */
	block_id?: string;
	/** Up to a line or so of text immediately before `quote`, for disambiguation. */
	prefix?: string;
	/** Up to a line or so of text immediately after `quote`. */
	suffix?: string;
	/**
	 * The palette entry the host wants it drawn in.
	 *
	 * A **string and not a union**, because the palette belongs to the host: the
	 * class is `ds-annotation-<color>` and what colours exist is a question about
	 * somebody's stylesheet, not about this package. Values are restricted to
	 * word characters before they reach a class name — see {@link colorClass}.
	 */
	color?: string;
	/** The reader's note about this passage. Drawn beside the text, never in it. */
	note?: string;
	/** Who made it, for the accessible description. */
	actor?: string;
}

/** An annotation the current document still has a place for. */
export interface ResolvedAnnotation {
	annotation: Annotation;
	from: number;
	to: number;
}

/**
 * Why an annotation has no place in the document.
 *
 * The shared core's reasons under ED-06's name. `missing` is the ordinary one —
 * the passage was rewritten; `ambiguous` is a quote so short and so repeated
 * that nothing says which copy, which refuses to draw for the reason it always
 * does: better a highlight in the panel than a highlight over a sentence the
 * reader never marked.
 */
export type AnnotationStaleReason = AnchorStaleReason;

/** An annotation that went stale, and which of the two ways it went. */
export interface StaleAnnotation {
	annotation: Annotation;
	reason: AnnotationStaleReason;
}

/**
 * Where the list comes from. A bare function is enough when the host repaints
 * itself; `subscribe` exists so a host whose list changes without a document
 * change (a highlight arriving over the wire, a colour changed in a panel) can
 * say so.
 */
export interface AnnotationSource {
	get(): readonly Annotation[];
	subscribe?(on_change: () => void): () => void;
}

export interface AnnotationCallbackContext {
	from: number;
	to: number;
	view: EditorView;
}

export interface AnnotationDecorationsOptions {
	/** The list, or something to read it from. */
	source: AnnotationSource | (() => readonly Annotation[]);
	/**
	 * The user picked a highlight — a click on the marked text, or the focus
	 * commands moving to it. The host usually opens its card.
	 */
	onSelect?(annotation: Annotation, context: AnnotationCallbackContext): void;
	/**
	 * The user asked to edit one — the note glyph, or the host's key. The host
	 * opens whatever it edits notes and colours in.
	 *
	 * Separate from `onSelect` because they are different intentions and the
	 * gestures that reach them are different gestures. Selecting a highlight
	 * while reading should not put a text field over the sentence.
	 */
	onEdit?(annotation: Annotation, context: AnnotationCallbackContext): void;
	/**
	 * Called after every resolve with the annotations that no longer have a place
	 * in the document. A stale annotation is **reported, never dropped** — the
	 * row still holds the quote, and the host shows it out of the text.
	 */
	onStale?(stale: readonly Annotation[], details: readonly StaleAnnotation[]): void;
	/** Draw the note glyph beside an annotation that has a note. On by default. */
	notes?: boolean;
	/** Overridable for translation. */
	labels?: {
		/** The note glyph's accessible name. `(annotation) => string`. */
		note?: string;
		describe?(annotation: Annotation): string;
	};
}

export const annotationDecorationsKey = new PluginKey<AnnotationPluginState>(
	'annotations',
);

interface AnnotationPluginState {
	decorations: DecorationSet;
	resolved: ResolvedAnnotation[];
	/** Id of the annotation the focus commands last moved to. */
	focused: string | null;
}

/** As much of a quotation as is useful to hear read out. */
function quote(text: string): string {
	const trimmed = text.trim();
	return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

/**
 * What the highlight says when the host has not written its own `describe`.
 *
 * The colour is deliberately not in it. A screen reader saying "yellow
 * highlight" reports a decision about pigment; what a listener needs is the
 * passage and whether there is a note on it.
 */
function describeAnnotation(annotation: Annotation): string {
	const who = annotation.actor ? `${annotation.actor} highlighted` : 'Highlight:';
	const said = `${who} “${quote(annotation.quote)}”`;
	return annotation.note ? `${said}. Note: ${quote(annotation.note)}` : said;
}

/**
 * The colour, as a class-name fragment, or `null`.
 *
 * The host owns the palette, so this cannot validate against a list — but it can
 * refuse to build a class name out of a string that is not one. Anything that is
 * not a short run of word characters is dropped rather than escaped: a colour is
 * a palette entry's *name*, and a name with a space or a quote in it is a bug in
 * the caller, not a colour this should try to render.
 */
function colorClass(color: string | undefined): string | null {
	if (!color || !/^[a-z0-9_-]{1,32}$/i.test(color)) return null;
	return `ds-annotation-${color}`;
}

/* ---- resolution ---------------------------------------------------------- */

function anchorOf(annotation: Annotation): TextAnchor {
	return {
		block_id: annotation.block_id,
		text: annotation.quote,
		prefix: annotation.prefix,
		suffix: annotation.suffix,
	};
}

/**
 * Resolves annotations against the current document by content, not by position.
 *
 * The finding is {@link resolveAnchors}, shared with ED-08's tracked changes;
 * why it re-finds rather than maps is written out there. The optional `cache` is
 * that module's {@link AnchorCache} — hand the same one to every resolve for one
 * editor and a highlight whose passage has been rewritten stops re-walking the
 * document on every keystroke. The plugin below keeps one.
 *
 * One thing is ED-06's own: an annotation with an **empty quote** is refused
 * rather than treated as a point. A suggestion with no `find` is a real thing —
 * a pure insertion — but a highlight over nothing is a row that should not
 * exist, and placing it at the front of its block would draw a zero-width
 * highlight the reader cannot see, cannot click, and cannot get rid of.
 */
export function resolveAnnotations(
	doc: PMNode,
	annotations: readonly Annotation[],
	cache?: AnchorCache,
): { resolved: ResolvedAnnotation[]; stale: StaleAnnotation[] } {
	const placeable: Annotation[] = [];
	const stale: StaleAnnotation[] = [];
	for (const annotation of annotations) {
		if (annotation.quote) placeable.push(annotation);
		else stale.push({ annotation, reason: 'missing' });
	}
	const found = resolveAnchors(doc, placeable, anchorOf, cache);
	for (const entry of found.stale) {
		stale.push({ annotation: entry.item, reason: entry.reason });
	}
	return {
		resolved: found.resolved.map((entry) => ({
			annotation: entry.item,
			from: entry.from,
			to: entry.to,
		})),
		stale,
	};
}

/* ---- decorations --------------------------------------------------------- */

/**
 * What the note glyph needs to be genuinely *outside* the text.
 *
 * `stopEvent` is not a nicety, and ED-08's review is where it was learned: a
 * widget's DOM sits inside the editor's contenteditable, so without it every
 * event that starts in the glyph also reaches ProseMirror's handlers — and the
 * glyph is a focusable `<button>`, so "press Enter to open the note" arrived at
 * the keymap as `Enter` and split the paragraph. A plugin whose entire premise
 * is that it never writes to the document was editing it from its own button.
 *
 * `ignoreSelection` says the widget's DOM is not somewhere a document selection
 * can be, so a browser selection landing inside it is not read back as a
 * position in the text.
 */
const WIDGET_ISOLATION = {
	stopEvent: () => true,
	ignoreSelection: true,
} as const;

function noteElement(
	item: ResolvedAnnotation,
	options: AnnotationDecorationsOptions,
	view: () => EditorView | null,
): HTMLElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'ds-annotation-note';
	const color = colorClass(item.annotation.color);
	if (color) button.classList.add(`${color}-note`);
	button.contentEditable = 'false';
	button.tabIndex = 0;
	button.setAttribute('data-annotation-id', item.annotation.id);
	const described =
		options.labels?.describe?.(item.annotation) ?? describeAnnotation(item.annotation);
	button.setAttribute('aria-label', `${options.labels?.note ?? 'Note'}: ${described}`);
	// `title` gives the pointer a hover card for free. `aria-describedby` would
	// need an id that survives a re-resolve, and the label already carries it.
	if (item.annotation.note) button.title = item.annotation.note;
	// A glyph and not an icon font: the package ships no asset for this and a
	// consumer's stylesheet can replace it. Hidden from the accessibility tree
	// because the button's own label already says what it is.
	const glyph = document.createElement('span');
	glyph.setAttribute('aria-hidden', 'true');
	glyph.textContent = '✎';
	button.append(glyph);
	button.addEventListener('mousedown', (event) => event.preventDefault());
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const current = view();
		if (!current) return;
		options.onEdit?.(item.annotation, { from: item.from, to: item.to, view: current });
	});
	return button;
}

function buildDecorations(
	state: EditorState,
	resolved: readonly ResolvedAnnotation[],
	options: AnnotationDecorationsOptions,
	view: () => EditorView | null,
	focused: string | null,
): DecorationSet {
	const decorations: Decoration[] = [];
	for (const item of resolved) {
		const classes = ['ds-annotation'];
		const color = colorClass(item.annotation.color);
		if (color) classes.push(color);
		if (item.annotation.note) classes.push('ds-annotation-has-note');
		if (focused === item.annotation.id) classes.push('ds-annotation-focused');
		decorations.push(
			Decoration.inline(item.from, item.to, {
				class: classes.join(' '),
				// `mark` is the element `<mark>` maps to in ARIA, and it is what a
				// highlight *is*. An inline decoration sets attributes on the text's
				// existing DOM and has no say in the tag, so the role is the only way
				// to say it here — and saying it matters more than usual, because
				// colour is the entire visual signal and a listener gets none of it.
				role: 'mark',
				'data-annotation-id': item.annotation.id,
			}),
		);
		if (options.notes !== false && item.annotation.note) {
			decorations.push(
				Decoration.widget(item.to, () => noteElement(item, options, view), {
					side: 1,
					key: `note:${item.annotation.id}:${item.annotation.note}:${focused === item.annotation.id}`,
					...WIDGET_ISOLATION,
				}),
			);
		}
	}
	return decorations.length
		? DecorationSet.create(state.doc, decorations)
		: DecorationSet.empty;
}

/**
 * The plugin. Install it with `registerPlugins`, or from the `plugins` option.
 *
 * ```ts
 * editor.registerPlugins([
 *   annotationDecorations({
 *     source: () => annotations,
 *     onSelect: (a) => showCard(a),
 *     onEdit: (a) => openEditor(a),
 *     onStale: (_list, details) => markStale(details),
 *   }),
 * ]);
 * ```
 */
export function annotationDecorations(options: AnnotationDecorationsOptions): Plugin {
	const read = (): readonly Annotation[] =>
		typeof options.source === 'function' ? options.source() : options.source.get();

	let live_view: EditorView | null = null;
	const view = () => live_view;
	// One per plugin instance, which is one per editor. Invalidated by node
	// identity, so nothing here has to remember to clear it.
	const cache = createAnchorCache();

	/**
	 * The stale list is reported on change rather than on every resolve — a
	 * resolve runs on every document change, and a host that wrote a row per
	 * keystroke would be paying repeatedly for a fact that has not moved.
	 */
	let last_stale = '';
	function reportStale(details: StaleAnnotation[]): void {
		const key = details
			.map((entry) => `${entry.annotation.id}:${entry.reason}`)
			.join(',');
		if (key === last_stale) return;
		last_stale = key;
		options.onStale?.(
			details.map((entry) => entry.annotation),
			details,
		);
	}

	function compute(state: EditorState, focused: string | null): AnnotationPluginState {
		const { resolved, stale } = resolveAnnotations(state.doc, read(), cache);
		reportStale(stale);
		const still_here = resolved.some((item) => item.annotation.id === focused)
			? focused
			: null;
		return {
			resolved,
			focused: still_here,
			decorations: buildDecorations(state, resolved, options, view, still_here),
		};
	}

	return new Plugin<AnnotationPluginState>({
		key: annotationDecorationsKey,
		state: {
			init: (_config, state) => compute(state, null),
			apply(tr, previous, _old, state) {
				const focus_meta = tr.getMeta(annotationDecorationsKey) as
					| { focused?: string | null; refresh?: true }
					| undefined;
				const focused =
					focus_meta && 'focused' in focus_meta
						? (focus_meta.focused ?? null)
						: previous.focused;
				// A document change re-resolves from the anchors — there is no `map`
				// step because there is nothing to map *from*: the anchors are text,
				// and the point of re-finding is that the answer comes from the new
				// document rather than from old positions dragged forward. A
				// transaction that leaves the document alone leaves the positions
				// alone too, so a selection change reuses the decoration set
				// untouched — which is what keeps the note glyph under the pointer
				// from flickering as the caret moves.
				if (!tr.docChanged && !focus_meta) return previous;
				if (!tr.docChanged && focus_meta && !focus_meta.refresh) {
					return {
						resolved: previous.resolved,
						focused,
						decorations: buildDecorations(
							state,
							previous.resolved,
							options,
							view,
							focused,
						),
					};
				}
				return compute(state, focused);
			},
		},
		props: {
			decorations: (state) => annotationDecorationsKey.getState(state)?.decorations,
			/**
			 * A click on the highlighted text itself.
			 *
			 * The highlight is an *inline* decoration, so its DOM is the paragraph's
			 * own text nodes — there is no element of ours to hang a listener on, and
			 * a `data-annotation-id` lookup off the event target would be reading
			 * back an attribute we asked ProseMirror to render and might not have.
			 * The position is the honest address, and the resolved list is already
			 * in document order at the position the click landed on.
			 *
			 * Returns `false` throughout: selecting a highlight is not handling the
			 * click. The caret still goes where the reader put it, which is what a
			 * click in a paragraph means everywhere else.
			 */
			handleClick(editor_view, pos) {
				const plugin_state = annotationDecorationsKey.getState(editor_view.state);
				if (!plugin_state || !options.onSelect) return false;
				// Innermost first: a highlight inside a highlight is a reader marking
				// a phrase inside a paragraph they had already marked, and the phrase
				// is the one they meant.
				const hit = [...plugin_state.resolved]
					.filter((item) => pos >= item.from && pos <= item.to)
					.sort((a, b) => a.to - a.from - (b.to - b.from))[0];
				if (!hit) return false;
				editor_view.dispatch(
					editor_view.state.tr.setMeta(annotationDecorationsKey, {
						focused: hit.annotation.id,
					}),
				);
				options.onSelect(hit.annotation, {
					from: hit.from,
					to: hit.to,
					view: editor_view,
				});
				return false;
			},
		},
		view(editor_view) {
			live_view = editor_view;
			const unsubscribe =
				typeof options.source === 'object' && options.source.subscribe
					? options.source.subscribe(() => {
							const current = live_view;
							if (!current) return;
							current.dispatch(
								current.state.tr.setMeta(annotationDecorationsKey, { refresh: true }),
							);
						})
					: undefined;
			return {
				destroy() {
					unsubscribe?.();
					live_view = null;
				},
			};
		},
	});
}

/* ---- commands ------------------------------------------------------------ */

/**
 * The keys are the host's to bind. This package's own keymap has no business
 * claiming a chord for a feature the host owns the data for; these are the
 * commands those keys run.
 */

function pluginState(state: EditorState): AnnotationPluginState | undefined {
	return annotationDecorationsKey.getState(state);
}

/** Every annotation the document currently has a place for, in document order. */
export function annotationsInDocument(state: EditorState): readonly ResolvedAnnotation[] {
	return pluginState(state)?.resolved ?? [];
}

/**
 * The focused annotation, or the innermost one under the caret, or the first one
 * after it.
 *
 * "Under the caret" comes before "after the caret" here, where ED-08's
 * equivalent has no such case: a suggestion is a thing you are moving between,
 * and an annotation is a thing you are usually standing in.
 */
export function focusedAnnotation(state: EditorState): ResolvedAnnotation | null {
	const plugin_state = pluginState(state);
	if (!plugin_state) return null;
	const { resolved, focused } = plugin_state;
	if (focused) {
		const match = resolved.find((item) => item.annotation.id === focused);
		if (match) return match;
	}
	const head = state.selection.from;
	const inside = resolved
		.filter((item) => head >= item.from && head <= item.to)
		.sort((a, b) => a.to - a.from - (b.to - b.from))[0];
	if (inside) return inside;
	return resolved.find((item) => item.from >= head) ?? resolved[0] ?? null;
}

function moveTo(item: ResolvedAnnotation | null): Command {
	return (state, dispatch) => {
		if (!item) return false;
		if (dispatch) {
			dispatch(
				state.tr
					.setMeta(annotationDecorationsKey, { focused: item.annotation.id })
					.scrollIntoView(),
			);
		}
		return true;
	};
}

/**
 * The first press moves *to* a highlight rather than past one.
 *
 * ED-08's equivalent steps straight to the second suggestion from a fresh
 * caret, because {@link focusedAnnotation} already answers with the first one
 * at or after the caret and "next" then advances from it. For suggestions that
 * is harmless — you are working through a queue. For annotations it is wrong:
 * the reader pressed a key to *get to* the highlight they can see, and skipping
 * it is the feature failing on its first keystroke. So while nothing is
 * explicitly focused, both commands land on whatever
 * {@link focusedAnnotation} names, and stepping only starts once something is.
 */
function step(delta: 1 | -1): Command {
	return (state, dispatch, view) => {
		const list = annotationsInDocument(state);
		if (!list.length) return false;
		const current = focusedAnnotation(state);
		if (!pluginState(state)?.focused) return moveTo(current)(state, dispatch, view);
		const index = current ? list.indexOf(current) : 0;
		return moveTo(list[(index + delta + list.length) % list.length])(
			state,
			dispatch,
			view,
		);
	};
}

/** Focus the next annotation after the focused one. Wraps. */
export const nextAnnotation: Command = step(1);

/** Focus the previous annotation. Wraps. */
export const previousAnnotation: Command = step(-1);

/**
 * The commands a host's keys run, built from the same options object the plugin
 * took — which is what stops a key and the note glyph calling two different
 * functions.
 */
export function annotationCommands(options: AnnotationDecorationsOptions): {
	selectAnnotation: Command;
	editAnnotation: Command;
	nextAnnotation: Command;
	previousAnnotation: Command;
} {
	const reach = (which: 'select' | 'edit'): Command => {
		return (state, _dispatch, view) => {
			const item = focusedAnnotation(state);
			const handler = which === 'select' ? options.onSelect : options.onEdit;
			// A command that returns `true` has told the keymap it handled the key.
			// With no callback bound nothing happened, so saying so lets the next
			// binding in the chain have the keystroke instead of swallowing it.
			if (!item || !view || !handler) return false;
			handler(item.annotation, { from: item.from, to: item.to, view });
			return true;
		};
	};
	return {
		selectAnnotation: reach('select'),
		editAnnotation: reach('edit'),
		nextAnnotation,
		previousAnnotation,
	};
}

/** What {@link annotationAnchorAt} records. */
export interface AnnotationAnchor {
	block_id?: string;
	quote: string;
	prefix: string;
	suffix: string;
	/**
	 * Whether the selection reached past the end of its block and was clamped.
	 *
	 * An annotation is anchored inside **one** block, because that is what makes
	 * it re-findable: a quote spanning a paragraph boundary would have to survive
	 * both paragraphs, and a `block_id` naming one of them is not an address for
	 * the pair. Dragging across two paragraphs is nonetheless an ordinary thing to
	 * do, so the selection is clamped rather than refused — and the clamp is
	 * **reported**, because silently highlighting a third of what somebody
	 * dragged over is the kind of thing they discover later and cannot explain.
	 * The host says so; this only knows that it happened.
	 */
	truncated: boolean;
}

/**
 * The anchor to record for the current selection — quote, and the context that
 * will tell its copies apart later.
 *
 * Exported because *making* an annotation is the host's, and every host would
 * otherwise write this same twenty lines slightly differently: the block the
 * selection starts in, the text of the selection with inline atoms padded out
 * exactly as the resolver pads them, and up to `context` characters either side
 * from the same block. Returns `null` for an empty selection, which is not an
 * annotation.
 *
 * A selection that runs past the end of its block is **clamped to the block and
 * the clamp reported** — see {@link AnnotationAnchor.truncated}.
 *
 * The context is taken from the **block**, not from the document, and that is
 * deliberate: a prefix that ran off the front of a paragraph into the previous
 * one would stop matching the moment either paragraph moved, which is precisely
 * the edit the context exists to survive.
 */
export function annotationAnchorAt(
	state: EditorState,
	options: { context?: number } = {},
): AnnotationAnchor | null {
	const context = options.context ?? 120;
	const { from, to } = state.selection;
	if (from === to) return null;
	const $from = state.doc.resolve(from);
	const block = $from.parent;
	if (!block.isTextblock) return null;
	const base = $from.start();
	// The same padding rule the resolver uses, so the offsets it computes and the
	// offsets recorded here are offsets into the same string.
	let text = '';
	block.forEach((child) => {
		if (child.isText) text += child.text ?? '';
		else text += ' '.repeat(child.nodeSize);
	});
	const start = from - base;
	const wanted = to - base;
	const end = Math.min(wanted, text.length);
	const quote = text.slice(start, end);
	if (!quote) return null;
	const id = block.attrs.block_id;
	return {
		block_id: typeof id === 'string' && id ? id : undefined,
		quote,
		prefix: text.slice(Math.max(0, start - context), start),
		suffix: text.slice(end, end + context),
		truncated: wanted > text.length,
	};
}
