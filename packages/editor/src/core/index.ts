export {
	Editor,
	type ActiveBlockInfo,
	type EditorEvent,
	type EditorOptions,
	type HistoryImplementation,
	type SelectionInfo,
} from './editor.svelte.js';
export { CommandRegistry } from './registry.svelte.js';
export { defineBlock, defineBlockSchema } from './block-spec.js';
export {
	backspaceCommand,
	// The four block commands the package's own keymap binds. Exported because a
	// palette entry has to *run* what a key runs — an app that could only reach
	// them through a keystroke would have to reimplement them for its command
	// list, and two spellings of "move this block up" is one too many.
	deleteLine,
	duplicateBlock,
	insertLine,
	insertNode,
	// `toggleBlockType` is `setBlockType` underneath, and `setBlockType`
	// *throws* on a node that is not a textblock — so it cannot be a blockquote
	// or a callout's toggle, and an app that needs one has nowhere to go: the
	// pair that builds it is `prosemirror-commands`', not this package's, and
	// re-exporting them is cheaper for everyone than a host taking a direct
	// dependency on a library it is already using through us.
	lift,
	moveBlock,
	toggleBlockType,
	toggleList,
	toggleMark,
	toggleTodoChecked,
	wrapIn,
} from './commands.js';
export {
	// ED-10. Document surgery — cutting one document in two, joining two into
	// one — as pure node-in/node-out functions rather than commands: the two
	// halves of a split do not live in the same editor, and the tail is written
	// into a document that has no editor open on it at all.
	joinDocuments,
	splitAt,
	type JoinDocumentsOptions,
	type SplitDocument,
} from './document.js';
export { buildKeymaps, type KeymapOptions } from './keymap.js';
export {
	baseInputRules,
	buildInputRules,
	markInputRule,
	// Re-exported so an app can write its own dialect's rules without taking a
	// direct dependency on `prosemirror-inputrules`.
	InputRule,
	inputRules,
	textblockTypeInputRule,
	// The command the package's own `Backspace` is chained from, so an app can
	// test that its rules are undoable with one press against the real thing.
	undoInputRule,
	wrappingInputRule,
} from './input-rules.js';
export { markdownClipboard, markdownClipboardKey } from './plugins/markdown-clipboard.js';
export { looksLikeMarkdown, parseMarkdown, parseInline } from './markdown.js';
export {
	placeholder,
	placeholderKey,
	type PlaceholderOption,
} from './plugins/placeholder.js';
export { blockIds, createBlockId } from './plugins/block-id.js';
export { suggestion, type SuggestionOptions } from './plugins/suggestion.js';
export {
	// ED-08. Tracked-changes decorations for suggestions the *host* owns. The
	// file is `tracked-changes.ts` because `suggestion.ts` is the trigger menu
	// above and has been since the package shipped; the factory keeps the name
	// a consumer will look for.
	focusedSuggestion,
	nextSuggestion,
	previousSuggestion,
	resolveSuggestions,
	suggestionCommands,
	suggestionDecorations,
	suggestionDecorationsKey,
	suggestionsInDocument,
	type ResolvedSuggestion,
	type SuggestionCallbackContext,
	type SuggestionDecorationsOptions,
	type SuggestionEdit,
	type SuggestionSource,
	type StaleReason,
	type StaleSuggestion,
} from './plugins/tracked-changes.js';
export {
	// The re-anchoring core both decoration plugins are built on. Exported
	// because a host that owns anchored rows of its own — a comment thread, a
	// bookmark — should not have to re-derive the scoring to agree with them.
	createAnchorCache,
	resolveAnchors,
	HOME_BONUS,
	type AnchorCache,
	type AnchorResolution,
	type AnchorStaleReason,
	type ResolvedAnchor,
	type StaleAnchor,
	type TextAnchor,
} from './plugins/anchors.js';
export {
	// ED-06. Annotation decorations for highlights and notes the *host* owns.
	annotationAnchorAt,
	annotationCommands,
	annotationDecorations,
	annotationDecorationsKey,
	annotationsInDocument,
	focusedAnnotation,
	nextAnnotation,
	previousAnnotation,
	resolveAnnotations,
	type Annotation,
	type AnnotationAnchor,
	type AnnotationCallbackContext,
	type AnnotationDecorationsOptions,
	type AnnotationSource,
	type AnnotationStaleReason,
	type ResolvedAnnotation,
	type StaleAnnotation,
} from './plugins/annotations.js';
export {
	// ED-07. Focus mode — dim everything outside the caret's sentence /
	// paragraph / block. Decorations only; the host owns the toggle, the unit
	// choice and the `ds-focus-dim` style.
	focusDim,
	focusDimKey,
	focusDimStateOf,
	setFocusDim,
	sentenceRangeIn,
	sentenceRangesIn,
	FOCUS_DIM_CLASS,
	type FocusDimOptions,
	type FocusDimPatch,
	type FocusDimState,
	type FocusUnit,
} from './plugins/focus-dim.js';
export {
	// ED-09. Passive term decoration — an externally-owned term set decorated
	// wherever the host's `match` seam finds it, with a modifier-key reveal
	// class and a modifier-click activation. Decorations only; invisible until
	// the host's CSS styles `ds-term` under the reveal or always-on class.
	setTermDecorations,
	termBlockText,
	termDecorations,
	termDecorationsKey,
	termDecorationsStateOf,
	termsInDocument,
	TERM_ALWAYS_CLASS,
	TERM_CLASS,
	TERM_REVEAL_CLASS,
	type TermActivateContext,
	type TermDecorationsMeta,
	type TermDecorationsOptions,
	type TermDecorationsState,
	type TermMatch,
} from './plugins/term-decorations.js';
export { builtinCommands } from './builtin-commands.js';
export { icons, type IconName } from './icons.js';
