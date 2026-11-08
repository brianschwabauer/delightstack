---
'@delightstack/editor': minor
---

Focus mode — `focusDim()`, an opt-in plugin that dims everything outside the unit of text the
caret is in: the current `sentence`, `paragraph` or `block`. Decorations only, and deliberately:
focus mode is a fact about one screen, not about the document, so nothing here writes a
transaction, enters the history, or survives serialization — the same footing as
`suggestionDecorations` and `annotationDecorations`.

Sentence boundaries come from `Intl.Segmenter` (Baseline, dictionary-driven, no locale — the
plugin does not know the document's language), with a best-effort abbreviation repair on top,
because ICU's sentence break carries no suppression list and would end a sentence after `Dr.`.
Dotted initialisms (`e.g.`, `p.m.`) and titles from a short explicit list (`Dr.`, `Mrs.`, `St.`)
merge into the sentence that follows — a list, not a shape rule, so a sentence ending in a name
or a month still ends where it ends. An environment without the segmenter degrades `sentence` to `paragraph`
rather than throwing.

The dimming is two kinds of decoration under one class (`ds-focus-dim`, or a host-supplied name):
`Decoration.node` on every block outside the caret's unit — which reaches images, rules and code
blocks the way an inline decoration cannot, and dims a whole subtree in one object — plus
`Decoration.inline` inside the caret's own textblock for the sentence unit. Recomputation happens
only when the selection or the document moves, and costs one walk of the caret's ancestors'
children plus a segmentation of the one block the caret is in; every other transaction maps the
existing set.

The package ships **no opacity**: the right dimming is a function of the host's theme, so the
class is the whole contract. The host toggles the mode with `setFocusDim(view, { enabled, unit })`
— a meta-only transaction — and reads it back with `focusDimStateOf(state)`. `sentenceRangesIn` /
`sentenceRangeIn` are exported for hosts (and tests) that need the boundaries themselves. No keys
are bound, per the package's rule: the host's keymap runs the toggle.
