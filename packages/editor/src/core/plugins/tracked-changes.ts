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
 * ED-08 — tracked-changes decorations for externally-owned suggestions.
 *
 * **Named `tracked-changes`, not `suggestion`.** `plugins/suggestion.ts` is
 * ED-04's trigger menu — the thing that opens on `/`, `@` and `[[` — and it has
 * owned that name since the package shipped. Two plugins called "suggestion" in
 * one editor is one too many, so the file that renders *proposed edits* takes
 * the name the feature is called everywhere outside this package: tracked
 * changes. The exported factory keeps `suggestionDecorations` because that is
 * what a consumer is looking for.
 *
 * **The plugin never owns the data.** A suggestion is a row in the host's own
 * table; this renders whatever the host hands it and calls back when the user
 * accepts or rejects. Nothing here writes to the document — accepting is the
 * host's edit to make, through whatever history the host has bound.
 *
 * **Nothing proposed is in the document.** That is the whole point of the
 * feature: an agent's proposal is metadata, so the document's history stays
 * clean until a person says yes. It has a consequence for the rendering that is
 * easy to miss — the *deleted* half of a suggestion is real text and takes an
 * inline decoration, but the *inserted* half does not exist anywhere in the
 * document and can only be a widget. There is no position to decorate.
 */

/** One proposed edit. Mirrors the host's row; the plugin stores none of it. */
export interface SuggestionEdit {
	/** The host's row id. Identity for callbacks, focus and keying. */
	id: string;
	/** Exact text to be replaced. Empty for a pure insertion. */
	find: string;
	/** Text proposed in its place. Empty for a pure deletion. */
	replace: string;
	/** Block the suggestion was made against, if the host recorded one. */
	block_id?: string;
	/** Up to a line or so of text immediately before `find`, for disambiguation. */
	prefix?: string;
	/** Up to a line or so of text immediately after `find`. */
	suffix?: string;
	/** Why the change was proposed. Rendered on the chip, not in the text. */
	note?: string;
	/** Who proposed it, for the chip's label. */
	actor?: string;
}

/** A suggestion the current document still has a place for. */
export interface ResolvedSuggestion {
	suggestion: SuggestionEdit;
	/** Start of the `find` range. Equal to `to` for a pure insertion. */
	from: number;
	/** End of the `find` range. */
	to: number;
	kind: 'insert' | 'delete' | 'replace';
}

/**
 * Why a suggestion has no place in the document.
 *
 * The shared core's {@link AnchorStaleReason} under ED-08's name — the two were
 * always the same two words, and re-declaring them would let them drift.
 */
export type StaleReason = AnchorStaleReason;

/** A suggestion that went stale, and which of the two ways it went. */
export interface StaleSuggestion {
	suggestion: SuggestionEdit;
	reason: StaleReason;
}

/**
 * Where the list comes from. A bare function is enough when the host repaints
 * itself; `subscribe` exists so a host whose list changes without a document
 * change (a suggestion arriving over the wire) can say so.
 */
export interface SuggestionSource {
	get(): readonly SuggestionEdit[];
	subscribe?(on_change: () => void): () => void;
}

export interface SuggestionCallbackContext {
	from: number;
	to: number;
	view: EditorView;
}

export interface SuggestionDecorationsOptions {
	/** The list, or something to read it from. */
	source: SuggestionSource | (() => readonly SuggestionEdit[]);
	/** The user accepted. The host applies the edit and updates its own row. */
	onAccept?(suggestion: SuggestionEdit, context: SuggestionCallbackContext): void;
	/**
	 * The user rejected. The host **resolves its own row**; the document is
	 * untouched.
	 *
	 * Resolves rather than deletes — the plugin has no opinion either way, but
	 * saying "deletes" read as a requirement, and a host that keeps a rejected
	 * proposal (so the reject is reversible, and so the write is idempotent) is
	 * doing the normal thing rather than working around this callback.
	 */
	onReject?(suggestion: SuggestionEdit, context: SuggestionCallbackContext): void;
	/**
	 * Called after every resolve with the suggestions that no longer have a
	 * place in the document. A stale suggestion is **reported, never dropped
	 * silently** — the host marks its row and shows it somewhere out of the
	 * text, because the text it was about is gone.
	 *
	 * `details` says which of the two ways each one went: `missing` (the text
	 * is not there any more) or `ambiguous` (it is there more than once and
	 * nothing says which copy). Both refuse to draw, and for the same reason —
	 * the alternative to refusing is striking through a sentence the user did
	 * not mean.
	 */
	onStale?(
		stale: readonly SuggestionEdit[],
		details: readonly StaleSuggestion[],
	): void;
	/** Draw the per-suggestion accept/reject chip. On by default. */
	chips?: boolean;
	/** Overridable for translation. */
	labels?: {
		accept?: string;
		reject?: string;
		/** `(actor) => string`, for the chip's hidden description. */
		describe?(suggestion: SuggestionEdit): string;
	};
}

export const suggestionDecorationsKey = new PluginKey<SuggestionPluginState>(
	'tracked_changes',
);

interface SuggestionPluginState {
	decorations: DecorationSet;
	resolved: ResolvedSuggestion[];
	/** Id of the suggestion `nextSuggestion`/`prevSuggestion` last moved to. */
	focused: string | null;
}

const DEFAULT_LABELS = {
	accept: 'Accept',
	reject: 'Reject',
};

/** As much of a quotation as is useful to hear read out. */
function quote(text: string): string {
	const trimmed = text.trim();
	return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

/**
 * What the chip says when the host has not written its own `describe`.
 *
 * The old default was `${actor}: ${kind}` — "agent:claude: replace" — which
 * names the machinery and not the change. Someone hearing this read out is
 * deciding whether to accept it, and what they need for that is the text.
 */
function describeEdit(item: ResolvedSuggestion): string {
	const who = item.suggestion.actor ? `${item.suggestion.actor} suggests` : 'Suggestion:';
	const { find, replace } = item.suggestion;
	if (item.kind === 'insert') return `${who} inserting “${quote(replace)}”`;
	if (item.kind === 'delete') return `${who} deleting “${quote(find)}”`;
	return `${who} replacing “${quote(find)}” with “${quote(replace)}”`;
}

function kindOf(edit: SuggestionEdit): 'insert' | 'delete' | 'replace' {
	if (!edit.find) return 'insert';
	if (!edit.replace) return 'delete';
	return 'replace';
}

/* ---- resolution ---------------------------------------------------------- */

/**
 * The anchor a suggestion is addressed by, in the shared core's vocabulary.
 *
 * `find` is the text; `block_id`, `prefix` and `suffix` mean what they mean
 * everywhere. A pure insertion has no `find`, which the core reads as a *point*
 * anchor and locates by its context.
 */
function anchorOf(edit: SuggestionEdit): TextAnchor {
	return {
		block_id: edit.block_id,
		text: edit.find,
		prefix: edit.prefix,
		suffix: edit.suffix,
	};
}

/**
 * Resolves suggestions against the current document by content, not by
 * position.
 *
 * The finding itself is {@link resolveAnchors} in `anchors.ts`, shared with
 * ED-06's annotations, and the addressing decision is written out there. The
 * optional `cache` is that module's {@link AnchorCache}: hand the same one to
 * every resolve for one editor and a suggestion that has gone stale stops
 * re-walking the whole document on every keystroke. The plugin below keeps one. What
 * stays here is the part that is about *suggestions*: which of the three kinds
 * each resolved edit is, and the shape of the answer ED-08 has always given.
 */
export function resolveSuggestions(
	doc: PMNode,
	edits: readonly SuggestionEdit[],
	cache?: AnchorCache,
): {
	resolved: ResolvedSuggestion[];
	stale: SuggestionEdit[];
	stale_details: StaleSuggestion[];
} {
	const { resolved, stale } = resolveAnchors(doc, edits, anchorOf, cache);
	const stale_details: StaleSuggestion[] = stale.map((entry) => ({
		suggestion: entry.item,
		reason: entry.reason,
	}));
	return {
		resolved: resolved.map((entry) => ({
			suggestion: entry.item,
			from: entry.from,
			to: entry.to,
			kind: kindOf(entry.item),
		})),
		// The bare list is what `onStale` has always been handed and what most
		// hosts do something with; `stale_details` is beside it rather than
		// instead of it so a host that only wants to know *that* a suggestion
		// went stale does not have to unwrap every entry to find out.
		stale: stale_details.map((entry) => entry.suggestion),
		stale_details,
	};
}

/* ---- decorations --------------------------------------------------------- */

function chipElement(
	item: ResolvedSuggestion,
	options: SuggestionDecorationsOptions,
	view: () => EditorView | null,
): HTMLElement {
	const labels = { ...DEFAULT_LABELS, ...options.labels };
	const chip = document.createElement('span');
	chip.className = 'ds-suggestion-chip';
	chip.setAttribute('role', 'group');
	chip.contentEditable = 'false';
	const described = options.labels?.describe?.(item.suggestion) ?? describeEdit(item);
	chip.setAttribute('aria-label', described);

	if (item.suggestion.note) {
		// The note is the agent's rationale and it belongs on the chip, not in
		// the text — it is about the change, not part of it. `title` gives the
		// pointer a hover card for free; `aria-describedby` would need an id
		// that survives a re-resolve, and the label already carries the note.
		chip.title = item.suggestion.note;
		chip.setAttribute('aria-label', `${described}. ${item.suggestion.note}`);
	}

	for (const action of ['accept', 'reject'] as const) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = `ds-suggestion-${action}`;
		button.tabIndex = 0;
		const label = action === 'accept' ? labels.accept : labels.reject;
		button.setAttribute('aria-label', `${label}: ${described}`);
		// A glyph as well as a colour, because the two buttons must not be
		// told apart by hue alone.
		button.textContent = action === 'accept' ? '✓' : '✕';
		button.addEventListener('mousedown', (event) => event.preventDefault());
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			const current = view();
			if (!current) return;
			const context: SuggestionCallbackContext = {
				from: item.from,
				to: item.to,
				view: current,
			};
			if (action === 'accept') options.onAccept?.(item.suggestion, context);
			else options.onReject?.(item.suggestion, context);
		});
		chip.append(button);
	}
	return chip;
}

/**
 * What both widgets need to be genuinely *outside* the text.
 *
 * `stopEvent` is not a nicety. A widget's DOM sits inside the editor's
 * contenteditable, so without it every event that starts in the chip also
 * reaches ProseMirror's handlers — and the chip contains focusable buttons, so
 * "press Enter to accept" arrived at the keymap as `Enter` and **split the
 * paragraph**. A plugin whose entire premise is that it never writes to the
 * document was editing it from its own accept button. The same applies to
 * Backspace, the printable keys, and anything else an app binds.
 *
 * `ignoreSelection` says the widget's DOM is not somewhere a document selection
 * can be, so a browser selection landing inside it is not read back as a
 * position in the text.
 */
const WIDGET_ISOLATION = {
	stopEvent: () => true,
	ignoreSelection: true,
} as const;

function buildDecorations(
	state: EditorState,
	resolved: readonly ResolvedSuggestion[],
	options: SuggestionDecorationsOptions,
	view: () => EditorView | null,
	focused: string | null,
): DecorationSet {
	const decorations: Decoration[] = [];
	for (const item of resolved) {
		const classes = ['ds-suggestion'];
		if (focused === item.suggestion.id) classes.push('ds-suggestion-focused');

		if (item.from !== item.to) {
			decorations.push(
				Decoration.inline(item.from, item.to, {
					class: [...classes, 'ds-suggestion-del'].join(' '),
					// The insertion gets to be a real `<ins>` because it is a
					// widget we build. The deletion cannot: an inline decoration
					// sets attributes on the text's existing DOM and has no say
					// in the tag, so the strike is a line and a colour and
					// nothing a screen reader can see. `role="deletion"` is the
					// ARIA mapping of `<del>` and is the only way to say it here.
					role: 'deletion',
					'data-suggestion-id': item.suggestion.id,
				}),
			);
		}
		if (item.suggestion.replace) {
			// The proposed text is not in the document, so it is a widget.
			decorations.push(
				Decoration.widget(
					item.to,
					() => {
						const ins = document.createElement('ins');
						ins.className = [...classes, 'ds-suggestion-ins'].join(' ');
						ins.setAttribute('data-suggestion-id', item.suggestion.id);
						ins.contentEditable = 'false';
						ins.textContent = item.suggestion.replace;
						return ins;
					},
					{
						side: 1,
						key: `ins:${item.suggestion.id}:${item.suggestion.replace}`,
						...WIDGET_ISOLATION,
					},
				),
			);
		}
		if (options.chips !== false) {
			decorations.push(
				Decoration.widget(item.to, () => chipElement(item, options, view), {
					side: 2,
					key: `chip:${item.suggestion.id}:${focused === item.suggestion.id}`,
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
 *   suggestionDecorations({
 *     source: () => pending_suggestions,
 *     onAccept: (s) => applyAndResolve(s),
 *     onReject: (s) => discard(s),
 *     onStale: (list) => markStale(list),
 *   }),
 * ]);
 * ```
 */
export function suggestionDecorations(options: SuggestionDecorationsOptions): Plugin {
	const read = (): readonly SuggestionEdit[] =>
		typeof options.source === 'function' ? options.source() : options.source.get();

	let live_view: EditorView | null = null;
	const view = () => live_view;
	// One per plugin instance, which is one per editor — the lifetime the cache
	// is correct over. It is invalidated by node identity rather than by anything
	// this file remembers to do, so a document swapped underneath simply looks
	// entirely new.
	const cache = createAnchorCache();

	/**
	 * The stale list is reported on change rather than on every resolve — a
	 * resolve runs on every document change, and a host that re-rendered a
	 * sidebar per keystroke would be paying for a fact that did not move.
	 */
	let last_stale = '';
	function reportStale(details: StaleSuggestion[]): void {
		// The reason is part of the key, not just the id: a suggestion that was
		// ambiguous and is now missing is a different thing to say about it.
		const key = details.map((entry) => `${entry.suggestion.id}:${entry.reason}`).join(',');
		if (key === last_stale) return;
		last_stale = key;
		options.onStale?.(
			details.map((entry) => entry.suggestion),
			details,
		);
	}

	function compute(state: EditorState, focused: string | null): SuggestionPluginState {
		const { resolved, stale_details } = resolveSuggestions(state.doc, read(), cache);
		reportStale(stale_details);
		// One `focused` for both, or the state says nothing is focused while the
		// decorations still carry the focus ring for a suggestion that is gone.
		const still_here = resolved.some((item) => item.suggestion.id === focused)
			? focused
			: null;
		return {
			resolved,
			focused: still_here,
			decorations: buildDecorations(state, resolved, options, view, still_here),
		};
	}

	return new Plugin<SuggestionPluginState>({
		key: suggestionDecorationsKey,
		state: {
			init: (_config, state) => compute(state, null),
			apply(tr, previous, _old, state) {
				const focus_meta = tr.getMeta(suggestionDecorationsKey) as
					| { focused?: string | null; refresh?: true }
					| undefined;
				const focused =
					focus_meta && 'focused' in focus_meta
						? (focus_meta.focused ?? null)
						: previous.focused;
				// A document change re-resolves from the anchors — there is no
				// `map` step because there is nothing to map *from*: the
				// anchors are text, and the whole point of re-finding is that
				// the answer comes from the new document rather than from the
				// old positions dragged forward. A transaction that leaves the
				// document alone leaves the positions alone too, so a selection
				// change reuses the decoration set untouched, which is what
				// keeps a chip under the cursor from flickering.
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
			decorations: (state) => suggestionDecorationsKey.getState(state)?.decorations,
		},
		view(editor_view) {
			live_view = editor_view;
			const unsubscribe =
				typeof options.source === 'object' && options.source.subscribe
					? options.source.subscribe(() => {
							const current = live_view;
							if (!current) return;
							current.dispatch(
								current.state.tr.setMeta(suggestionDecorationsKey, { refresh: true }),
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
 * The keys are the host's to bind — `11`-style tables live in apps, and this
 * package's own keymap has no business claiming `Mod-Enter`. These are the
 * commands those keys run.
 */

function pluginState(state: EditorState): SuggestionPluginState | undefined {
	return suggestionDecorationsKey.getState(state);
}

/** Every suggestion the document currently has a place for, in document order. */
export function suggestionsInDocument(state: EditorState): readonly ResolvedSuggestion[] {
	return pluginState(state)?.resolved ?? [];
}

/** The focused suggestion, or the first one at or after the caret. */
export function focusedSuggestion(state: EditorState): ResolvedSuggestion | null {
	const plugin_state = pluginState(state);
	if (!plugin_state) return null;
	const { resolved, focused } = plugin_state;
	if (focused) {
		const match = resolved.find((item) => item.suggestion.id === focused);
		if (match) return match;
	}
	const head = state.selection.from;
	return resolved.find((item) => item.to >= head) ?? resolved[0] ?? null;
}

function moveTo(item: ResolvedSuggestion | null): Command {
	return (state, dispatch) => {
		if (!item) return false;
		if (dispatch) {
			dispatch(
				state.tr
					.setMeta(suggestionDecorationsKey, { focused: item.suggestion.id })
					.scrollIntoView(),
			);
		}
		return true;
	};
}

/** `Mod-.` — focus the next suggestion after the focused one. */
export const nextSuggestion: Command = (state, dispatch, view) => {
	const list = suggestionsInDocument(state);
	if (!list.length) return false;
	const current = focusedSuggestion(state);
	const index = current ? list.indexOf(current) : -1;
	return moveTo(list[(index + 1) % list.length])(state, dispatch, view);
};

/** `Mod-,` — focus the previous suggestion. */
export const previousSuggestion: Command = (state, dispatch, view) => {
	const list = suggestionsInDocument(state);
	if (!list.length) return false;
	const current = focusedSuggestion(state);
	const index = current ? list.indexOf(current) : 0;
	return moveTo(list[(index - 1 + list.length) % list.length])(state, dispatch, view);
};

function resolveOne(
	action: 'accept' | 'reject',
	options: SuggestionDecorationsOptions,
): Command {
	return (state, _dispatch, view) => {
		const item = focusedSuggestion(state);
		const handler = action === 'accept' ? options.onAccept : options.onReject;
		// A command that returns `true` has told the keymap it handled the key.
		// With no callback bound nothing happened, so saying so lets the next
		// binding in the chain have the keystroke instead of swallowing it.
		if (!item || !view || !handler) return false;
		handler(item.suggestion, { from: item.from, to: item.to, view });
		return true;
	};
}

/**
 * `Mod-Enter` / `Mod-Backspace`, and the `all` variants behind `Mod-Alt`.
 *
 * They take the same options object the plugin took, because the callbacks are
 * the host's and a command has no other way to reach them — and because the
 * pair being built from one object is what stops a key and a chip calling two
 * different functions.
 */
export function suggestionCommands(options: SuggestionDecorationsOptions): {
	acceptSuggestion: Command;
	rejectSuggestion: Command;
	acceptAllSuggestions: Command;
	rejectAllSuggestions: Command;
	nextSuggestion: Command;
	previousSuggestion: Command;
} {
	const all = (action: 'accept' | 'reject'): Command => {
		return (state, _dispatch, view) => {
			const list = suggestionsInDocument(state);
			const handler = action === 'accept' ? options.onAccept : options.onReject;
			if (!list.length || !view || !handler) return false;
			// Back to front: the host applies these as real edits, and applying
			// one shifts every position after it.
			for (const item of [...list].reverse()) {
				handler(item.suggestion, { from: item.from, to: item.to, view });
			}
			return true;
		};
	};
	return {
		acceptSuggestion: resolveOne('accept', options),
		rejectSuggestion: resolveOne('reject', options),
		acceptAllSuggestions: all('accept'),
		rejectAllSuggestions: all('reject'),
		nextSuggestion,
		previousSuggestion,
	};
}
