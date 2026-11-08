import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { Mark } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { SuggestionContext, SuggestionHandler } from '../../types/index.js';

export interface SuggestionOptions {
	/**
	 * The trigger: '/' for the slash menu, '@' for mentions, '[[' for
	 * wikilinks. One character or several — the whole string has to be typed
	 * before the menu opens, and the query is what follows it.
	 */
	char: string;
	/**
	 * Extra gate for opening (e.g. only in empty paragraphs). Runs after the
	 * built-in checks (cursor in a non-code textblock, trigger at word start).
	 */
	allow?: (state: EditorState, trigger_pos: number) => boolean;
	/**
	 * Whether the trigger has to start a word — the block's first character, or
	 * one after whitespace. Default `true`.
	 *
	 * The rule exists so that a `/` in the middle of a sentence is just a
	 * slash. A multi-character trigger has far less to fear from that: `[[` is
	 * not something anybody types by accident, and it legitimately follows an
	 * opening bracket or a dash. Turn it off for those.
	 */
	word_start?: boolean;
	/**
	 * Late-bound handler ref: the owning Svelte component assigns its
	 * handler here so all menu state lives in Svelte while this plugin stays
	 * a dumb keystroke router.
	 */
	handler: () => SuggestionHandler | null;
	/** Close when the query grows past this length without a match. Default 64 */
	max_query_length?: number;
}

interface SuggestionState {
	active: { from: number; to: number; query: string } | null;
	/** Trigger position dismissed via Escape — don't reopen until it's gone */
	dismissed: number | null;
}

/**
 * Generic trigger plugin. Finds `char` + query before the cursor, routes
 * open/update/close + keydown to the Svelte-owned handler, and stays inert
 * during IME composition.
 *
 * The trigger is a *string*, not a character: `[[` is one trigger, and the
 * arithmetic below is written in terms of its length rather than assuming 1.
 */
export function suggestion(options: SuggestionOptions): Plugin<SuggestionState> {
	const key = new PluginKey<SuggestionState>(`suggestion_${options.char}`);
	const maxQuery = options.max_query_length ?? 64;
	const trigger = options.char;
	const trigger_length = trigger.length;
	const word_start = options.word_start ?? true;

	function findMatch(state: EditorState): SuggestionState['active'] {
		const { $from: from, empty } = state.selection;
		if (!empty || !from.parent.isTextblock || from.parent.type.spec.code) return null;
		// A code *mark* is code as much as a code block is. Without this a `/` or
		// a `[[` typed inside an inline code span opens the menu, and a menu that
		// inserts a node on accept then replaces the span's own text with one —
		// which is the code the user was quoting, gone.
		if ((state.storedMarks ?? from.marks()).some(isCodeMark)) return null;
		const textBefore = from.parent.textBetween(
			Math.max(0, from.parentOffset - maxQuery - trigger_length),
			from.parentOffset,
			undefined,
			'￼',
		);
		const index = textBefore.lastIndexOf(trigger);
		if (index === -1) return null;
		// Trigger must be at the start of the block or after whitespace
		const before = index === 0 ? '' : textBefore[index - 1];
		if (word_start && before && !/\s/.test(before)) return null;
		const query = textBefore.slice(index + trigger_length);
		// A newline-ish or object replacement char in the query kills it
		if (query.includes('￼')) return null;
		const triggerPos = from.pos - query.length - trigger_length;
		if (options.allow && !options.allow(state, triggerPos)) return null;
		return { from: triggerPos, to: from.pos, query };
	}

	return new Plugin<SuggestionState>({
		key,
		state: {
			init: () => ({ active: null, dismissed: null }),
			apply(tr, value, _oldState, newState) {
				if (tr.getMeta(key) === 'dismiss') {
					return { active: null, dismissed: value.active?.from ?? null };
				}
				// A dismissed trigger position must follow the text it refers
				// to as the document changes around it, or an escaped menu pops
				// back open (and unrelated triggers get wrongly suppressed).
				let dismissed = value.dismissed;
				if (dismissed !== null && tr.docChanged) {
					const mapped = tr.mapping.mapResult(dismissed);
					dismissed = mapped.deleted ? null : mapped.pos;
				}
				// Only typing can OPEN the menu — moving the caret into existing
				// text that happens to contain the trigger char must not
				// resurrect it. An already-open menu still re-evaluates on
				// selection moves (so clicking away closes it).
				if (!value.active && !tr.docChanged) return { active: null, dismissed };
				const match = findMatch(newState);
				if (dismissed !== null) {
					if (match && match.from === dismissed) return { active: null, dismissed };
					dismissed = null;
				}
				return { active: match, dismissed };
			},
		},
		props: {
			handleKeyDown(view, event) {
				const state = key.getState(view.state);
				if (!state?.active) return false;
				const handler = options.handler();
				if (!handler) return false;
				if (event.key === 'Escape') {
					view.dispatch(view.state.tr.setMeta(key, 'dismiss'));
					return true;
				}
				return handler.keydown(event);
			},
		},
		view(editorView) {
			let wasActive = false;
			const notify = (view: EditorView) => {
				if (view.composing) return;
				const state = key.getState(view.state);
				const handler = options.handler();
				if (!handler) return;
				const active = state?.active ?? null;
				if (active) {
					const ctx: SuggestionContext = {
						query: active.query,
						range: { from: active.from, to: active.to },
						rect: coordsToRect(view, active.from),
						dismiss: () => view.dispatch(view.state.tr.setMeta(key, 'dismiss')),
					};
					if (wasActive) handler.update(ctx);
					else handler.open(ctx);
					wasActive = true;
				} else if (wasActive) {
					handler.close();
					wasActive = false;
				}
			};
			const onCompositionStart = () => {
				if (!wasActive) return;
				options.handler()?.close();
				wasActive = false;
			};
			editorView.dom.addEventListener('compositionstart', onCompositionStart);
			// Initial state
			notify(editorView);
			return {
				update: notify,
				destroy() {
					editorView.dom.removeEventListener('compositionstart', onCompositionStart);
					if (wasActive) options.handler()?.close();
				},
			};
		},
	});
}

/**
 * Whether a mark makes its text code.
 *
 * `spec.code` is the flag ProseMirror gives *nodes*; marks have no equivalent,
 * so a schema that names its mark `code` — which the package's own does, and
 * every schema built on it — is honoured by name as well.
 */
function isCodeMark(mark: Mark): boolean {
	return mark.type.spec.code === true || mark.type.name === 'code';
}

function coordsToRect(view: EditorView, pos: number): DOMRect | null {
	try {
		const coords = view.coordsAtPos(pos);
		return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
	} catch {
		return null;
	}
}
