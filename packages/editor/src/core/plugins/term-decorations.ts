import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Mark, Node as PMNode } from 'prosemirror-model';

/**
 * ED-09 — passive term decoration for an externally-owned term set.
 *
 * A glossary, a character register, a linter's word list: the host knows a set
 * of strings, and wants every whole occurrence in the document decorated —
 * *passively*. The decorations are invisible until the host's CSS says
 * otherwise, a modifier-key reveal class is managed for it, and a
 * modifier-click on a decorated range calls back with the term's id. Nothing
 * here writes to the document, enters the history, or survives serialization —
 * the same footing as `suggestionDecorations`, `annotationDecorations` and
 * `focusDim`.
 *
 * **The matcher is the host's.** ED-09 was filed asking for a zero-dependency
 * Aho–Corasick in the package; what shipped is narrower and better: a `match`
 * seam. The host hands a function from text to term ranges, and the plugin
 * owns everything positional — walking the document's textblocks, keeping
 * character offsets aligned with ProseMirror positions, recomputing only the
 * blocks an edit touched. The reason is that matching *rules* are the host's
 * dialect: which forms are case-sensitive, what counts as a word boundary in
 * Cyrillic, whether `Warwick's` is a mention of `Warwick` — a host with a
 * server-side matcher (DelightWrite's projection writes mention rows from one)
 * must decorate with **the same code**, not with this package's opinion of it.
 * A host without one can hand any function at all; `new RegExp` on a short
 * list is fine for a glossary.
 *
 * ## The text a block hands the matcher
 *
 * For each textblock, the plugin builds one string whose index `i` is exactly
 * the ProseMirror position `block_start + 1 + i`:
 *
 * - a text node contributes its characters (or spaces of the same length when
 *   one of its marks is skipped — inline code, by default);
 * - any other inline child contributes U+FFFC (the object replacement
 *   character) once per position it occupies.
 *
 * Both substitutions keep the string's length equal to the block's content
 * size, which is what makes the offset arithmetic exact — no segment table,
 * no re-anchoring. U+FFFC is not a word character in any matcher worth having,
 * so an atom (a link node, an image) is a hard word boundary on both sides,
 * and skipped text can never carry a match.
 *
 * The matcher's returned offsets must index into **the string it was given**.
 * A matcher that normalizes internally (NFC, case folding) owns the mapping
 * back to the handed string; the plugin spends the offsets as positions
 * verbatim.
 *
 * ## Cost
 *
 * The initial state matches every textblock once. After that, a transaction
 * recomputes only the textblocks its steps touched — everything else is
 * mapped — so a keystroke in a 100,000-word document pays for one paragraph.
 * A `refresh` meta (the term set changed) re-matches the whole document; the
 * host sends it when the set actually changes, not per keystroke.
 */

/** One occurrence of one term, as offsets into the text handed to `match`. */
export interface TermMatch {
	/** The host's id for the term — what `onActivate` gets back. */
	term_id: string;
	/** Start offset, inclusive. */
	from: number;
	/** End offset, exclusive. */
	to: number;
}

export interface TermActivateContext {
	from: number;
	to: number;
	view: EditorView;
	event: MouseEvent;
}

export interface TermDecorationsOptions {
	/**
	 * The matcher. Given one textblock's text (placeholders and skip-masking
	 * already applied — see the module comment), returns every occurrence as
	 * offsets into that same string. Called per changed block, so it should be
	 * cheap to *call*; building anything expensive belongs behind the host's
	 * own cache.
	 */
	match(text: string): readonly TermMatch[];
	/**
	 * A modifier-click landed on a decorated range. The host navigates (or
	 * doesn't); returning `false` lets the click fall through to the editor.
	 * When ranges overlap, the narrowest one containing the click wins — the
	 * most specific term is the one the pointer meant.
	 */
	onActivate?(term_id: string, context: TermActivateContext): boolean | void;
	/**
	 * Start with the always-on class applied? Off by default — ED-09 terms are
	 * invisible until revealed. Toggled later with {@link setTermDecorations}.
	 */
	always_on?: boolean;
	/** The class every term decoration carries. The host styles it. */
	class_name?: string;
	/**
	 * The class managed on the editor's root element while the modifier key is
	 * held — the reveal. The host's CSS makes `.reveal .term` visible.
	 */
	reveal_class?: string;
	/** The class on the editor's root element while `always_on` is set. */
	always_class?: string;
	/**
	 * Which key reveals and which click activates. `mod` (the default) is meta
	 * on Apple platforms and control elsewhere.
	 */
	modifier?: 'mod' | 'meta' | 'ctrl';
	/**
	 * Skip a block entirely. Defaults to code blocks (`spec.code`), because a
	 * term inside a code listing is an identifier, not a mention.
	 */
	skip_block?(node: PMNode): boolean;
	/**
	 * Mask a text node's characters to spaces before matching. Defaults to the
	 * mark named `code`, for the block rule's reason.
	 */
	skip_mark?(mark: Mark): boolean;
}

export interface TermDecorationsState {
	decorations: DecorationSet;
	always_on: boolean;
}

/** What a meta transaction may change. */
export interface TermDecorationsMeta {
	/** Re-match the whole document — the term set changed. */
	refresh?: boolean;
	always_on?: boolean;
}

export const termDecorationsKey = new PluginKey<TermDecorationsState>('term_decorations');

/** The default decoration class. `ds-`-prefixed like every other plugin's. */
export const TERM_CLASS = 'ds-term';
/** The default reveal class on the editor's root while the modifier is held. */
export const TERM_REVEAL_CLASS = 'ds-terms-reveal';
/** The default class on the editor's root while terms are always shown. */
export const TERM_ALWAYS_CLASS = 'ds-terms-always';

/**
 * One position per string index — see the module comment. U+FFFC because it is
 * what the character *means* (an object stands here), and because no word
 * matcher treats it as a letter.
 */
const PLACEHOLDER = '￼';

function defaultSkipBlock(node: PMNode): boolean {
	return Boolean(node.type.spec.code);
}

function defaultSkipMark(mark: Mark): boolean {
	return mark.type.name === 'code';
}

/** Whether this runtime's `mod` is the meta key. */
function isApplePlatform(): boolean {
	if (typeof navigator === 'undefined') return false;
	return /Mac|iP(?:hone|ad|od)/.test(navigator.platform);
}

function modifierHeld(
	event: MouseEvent | KeyboardEvent,
	modifier: TermDecorationsOptions['modifier'],
): boolean {
	if (modifier === 'meta') return event.metaKey;
	if (modifier === 'ctrl') return event.ctrlKey;
	return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

function isModifierKey(
	key: string,
	modifier: TermDecorationsOptions['modifier'],
): boolean {
	if (modifier === 'meta') return key === 'Meta';
	if (modifier === 'ctrl') return key === 'Control';
	return key === (isApplePlatform() ? 'Meta' : 'Control');
}

/**
 * One textblock's content as the string the matcher sees.
 *
 * Exported for hosts and tests that need to agree with the plugin about what
 * exactly was matched — the app-side offset test is built on it.
 */
export function termBlockText(
	node: PMNode,
	skip_mark: (mark: Mark) => boolean = defaultSkipMark,
): string {
	let out = '';
	node.forEach((child) => {
		if (child.isText) {
			const text = child.text ?? '';
			out += child.marks.some(skip_mark) ? ' '.repeat(text.length) : text;
		} else {
			out += PLACEHOLDER.repeat(child.nodeSize);
		}
	});
	return out;
}

function decorationsForBlock(
	node: PMNode,
	pos: number,
	options: TermDecorationsOptions,
): Decoration[] {
	if ((options.skip_block ?? defaultSkipBlock)(node)) return [];
	const text = termBlockText(node, options.skip_mark ?? defaultSkipMark);
	if (text.length === 0) return [];
	const class_name = options.class_name ?? TERM_CLASS;
	const found: Decoration[] = [];
	for (const match of options.match(text)) {
		if (!Number.isInteger(match.from) || !Number.isInteger(match.to)) continue;
		if (match.from < 0 || match.to > text.length || match.from >= match.to) continue;
		found.push(
			Decoration.inline(
				pos + 1 + match.from,
				pos + 1 + match.to,
				{ class: class_name, 'data-term-id': match.term_id },
				{ term_id: match.term_id },
			),
		);
	}
	return found;
}

function computeAll(doc: PMNode, options: TermDecorationsOptions): DecorationSet {
	const found: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		found.push(...decorationsForBlock(node, pos, options));
		return false;
	});
	return DecorationSet.create(doc, found);
}

/** The plugin's state, or `undefined` when the plugin is not installed. */
export function termDecorationsStateOf(
	state: EditorState,
): TermDecorationsState | undefined {
	return termDecorationsKey.getState(state) ?? undefined;
}

/** Every decorated term in document order, for panels and tests. */
export function termsInDocument(
	state: EditorState,
): { term_id: string; from: number; to: number }[] {
	const held = termDecorationsStateOf(state);
	if (!held) return [];
	return held.decorations.find().map((decoration) => ({
		term_id: String((decoration.spec as { term_id?: unknown }).term_id ?? ''),
		from: decoration.from,
		to: decoration.to,
	}));
}

/**
 * Change the plugin's state — a meta-only transaction, like `setFocusDim`.
 * `refresh: true` re-matches the whole document (send it when the term set
 * changes); `always_on` toggles the root class the host's CSS keys on.
 */
export function setTermDecorations(view: EditorView, patch: TermDecorationsMeta): void {
	view.dispatch(view.state.tr.setMeta(termDecorationsKey, patch));
}

export function termDecorations(options: TermDecorationsOptions): Plugin {
	const modifier = options.modifier ?? 'mod';
	const reveal_class = options.reveal_class ?? TERM_REVEAL_CLASS;
	const always_class = options.always_class ?? TERM_ALWAYS_CLASS;

	return new Plugin<TermDecorationsState>({
		key: termDecorationsKey,
		state: {
			init: (_config, state): TermDecorationsState => ({
				decorations: computeAll(state.doc, options),
				always_on: options.always_on ?? false,
			}),
			apply: (tr, value): TermDecorationsState => {
				const meta = tr.getMeta(termDecorationsKey) as TermDecorationsMeta | undefined;
				const always_on = meta?.always_on ?? value.always_on;
				if (meta?.refresh) {
					return { always_on, decorations: computeAll(tr.doc, options) };
				}
				if (!tr.docChanged) {
					if (always_on === value.always_on && meta === undefined) return value;
					return { always_on, decorations: value.decorations };
				}
				let decorations = value.decorations.map(tr.mapping, tr.doc);
				// The textblocks this transaction touched, in the *final*
				// document's coordinates: each step map's new ranges, carried
				// through the maps of every later step.
				//
				// Mark and attr steps are the trap: they change the document —
				// toggling inline `code` over a term must drop its decoration,
				// exactly as the host's masking rules say — but their step maps
				// are **empty**, so a range walk over the maps alone would leave
				// a stale, clickable decoration on text that no longer matches.
				// A step that mapped nothing contributes its own `from`/`to`
				// (or `pos`) instead, carried through the later maps the same
				// way; a step with neither (a doc-level attr) touches no block.
				const blocks = new Map<number, PMNode>();
				const doc_size = tr.doc.content.size;
				tr.steps.forEach((step, index) => {
					const rest = tr.mapping.slice(index + 1);
					const touch = (new_from: number, new_to: number) => {
						const from = Math.max(0, Math.min(rest.map(new_from, -1), doc_size));
						let to = Math.max(from, Math.min(rest.map(new_to, 1), doc_size));
						// A point range (an attr step's bare `pos`) names the
						// position *before* a node; `nodesBetween` visits nothing
						// for an empty range, so widen it one position into the
						// node it points at.
						if (to === from) to = Math.min(from + 1, doc_size);
						tr.doc.nodesBetween(from, to, (node, pos) => {
							if (!node.isTextblock) return true;
							blocks.set(pos, node);
							return false;
						});
					};
					let mapped = false;
					step.getMap().forEach((_old_from, _old_to, new_from, new_to) => {
						mapped = true;
						touch(new_from, new_to);
					});
					if (mapped) return;
					const ranged = step as unknown as {
						from?: unknown;
						to?: unknown;
						pos?: unknown;
					};
					const from =
						typeof ranged.from === 'number'
							? ranged.from
							: typeof ranged.pos === 'number'
								? ranged.pos
								: undefined;
					if (from === undefined) return;
					touch(from, typeof ranged.to === 'number' ? ranged.to : from);
				});
				for (const [pos, node] of blocks) {
					const block_from = pos + 1;
					const block_to = pos + 1 + node.content.size;
					decorations = decorations.remove(decorations.find(block_from, block_to));
					decorations = decorations.add(tr.doc, decorationsForBlock(node, pos, options));
				}
				return { always_on, decorations };
			},
		},
		props: {
			decorations(state) {
				return termDecorationsKey.getState(state)?.decorations;
			},
			handleClick(view, pos, event) {
				if (!options.onActivate) return false;
				if (!modifierHeld(event, modifier)) return false;
				const held = termDecorationsKey.getState(view.state);
				if (!held) return false;
				// The narrowest decoration containing the click — `Elias` inside
				// `Elias Warwick` means the pointer was on both, and the shorter
				// range is the more specific statement.
				const hits = held.decorations
					.find(pos, pos)
					.sort((a, b) => a.to - a.from - (b.to - b.from));
				const hit = hits[0];
				if (!hit) return false;
				const term_id = String((hit.spec as { term_id?: unknown }).term_id ?? '');
				if (!term_id) return false;
				const handled = options.onActivate(term_id, {
					from: hit.from,
					to: hit.to,
					view,
					event,
				});
				return handled !== false;
			},
		},
		view(editor_view) {
			// The reveal is a class on the editor's root, not a decoration
			// rebuild: pressing the modifier must not re-render a novel. Window
			// listeners, because the modifier goes down wherever focus is; blur
			// clears it, because the keyup happens in the other window.
			const dom = editor_view.dom;
			const sync = (state: EditorState) => {
				const held = termDecorationsKey.getState(state);
				dom.classList.toggle(always_class, held?.always_on ?? false);
			};
			const down = (event: KeyboardEvent) => {
				if (isModifierKey(event.key, modifier)) dom.classList.add(reveal_class);
			};
			const up = (event: KeyboardEvent) => {
				if (isModifierKey(event.key, modifier)) dom.classList.remove(reveal_class);
			};
			const clear = () => dom.classList.remove(reveal_class);
			if (typeof window !== 'undefined') {
				window.addEventListener('keydown', down);
				window.addEventListener('keyup', up);
				window.addEventListener('blur', clear);
			}
			sync(editor_view.state);
			return {
				update: (view) => sync(view.state),
				destroy: () => {
					if (typeof window !== 'undefined') {
						window.removeEventListener('keydown', down);
						window.removeEventListener('keyup', up);
						window.removeEventListener('blur', clear);
					}
					dom.classList.remove(reveal_class);
					dom.classList.remove(always_class);
				},
			};
		},
	});
}
