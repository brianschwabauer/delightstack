---
'@delightstack/editor': minor
---

Tracked-changes decorations for suggestions the host owns — `suggestionDecorations()`, plus
`resolveSuggestions`, `suggestionCommands`, `suggestionsInDocument`, `focusedSuggestion`,
`nextSuggestion` and `previousSuggestion`.

An agent (or a collaborator, or a linter) proposes an edit; the editor renders it inline as a
strike over the text to be replaced and a widget carrying the text proposed in its place, with a
small accept/reject chip and the proposer's note. **The plugin owns none of the data.** It reads a
list the host supplies and calls back when the user decides; accepting is the host's edit to make,
through whatever history the host has bound. Nothing here writes to the document, which is the
property the feature exists for: a proposal is metadata, so a document's history stays clean until
a person says yes.

The addressing is the decision worth knowing about. A suggestion is anchored by
`{block_id, find, prefix, suffix}` and **re-found on every document change**, not held as a mapped
position. A proposal is made against text that was read elsewhere, by something that never had this
editor open and so never had a position to take — there is only text to find again. Re-finding is
also the behaviour the feature wants: edit around a suggestion and it follows the sentence it was
about; delete that sentence and it goes stale, which is reported to the host through `onStale`
rather than collapsing quietly to a caret. Stale suggestions are never dropped silently.

The insertion half of a proposal is a **widget**, not an inline decoration, because the proposed
text is not in the document and there is no range to decorate. Both widgets are isolated from the
editor with `stopEvent` and `ignoreSelection`: a widget's DOM lives inside the contenteditable, and
the chip contains focusable buttons, so without that a keystroke aimed at the accept button also
reached the keymap.

Matching tolerates Unicode normalisation. `find`, `prefix` and `suffix` arrive from somewhere else
— over MCP, out of a JSON body, out of a projection that went through another runtime — and `café`
has two spellings that are the same text and not the same string. Each is tried in both composed
and decomposed form against the document's own text, which is left alone so the position arithmetic
stays honest; the resolved range is the length of what the *document* holds, not of the needle.

A pure insertion anchors to whichever context it has: after `prefix`, or before `suffix` when there
is no text before it, or at the front of the block the host named when it has neither. A resolve
stops as soon as the recorded block answers, since a hit there outranks anything the rest of the
document can score — which keeps a keystroke off the O(suggestions x document) path.

Styling is nine `--editor-suggestion-*` custom properties with defaults derived from
`--color-success` / `--color-error`, so a host that already has an insertion green and a deletion
red hands them over instead of matching them by eye. Colour is never the only signal: the deletion
is struck through, the insertion underlined, and the two chip buttons are a check and a cross.

The file is `plugins/tracked-changes.ts` rather than `plugins/suggestion.ts` — that name belongs to
the trigger menu (`/`, `@`, `[[`) and has since the package shipped. The exported factory keeps
`suggestionDecorations`, which is what a consumer looks for.

No keys are bound. Accept/reject/next/previous are exported as commands for the host's own keymap,
because a table of editor shortcuts belongs to an app; the chip's own buttons are real `<button>`s,
so Enter and Space already work on them without the package claiming a chord.

A suggestion whose `find` occurs more than once with nothing to tell the copies apart goes **stale
with reason `ambiguous`** rather than resolving to the first match. Document order is not a
tie-break: the alternative to refusing is striking through a sentence in whichever paragraph came
first and calling that a decision. `resolveSuggestions` now returns `stale_details` — each entry
`{ suggestion, reason: 'missing' | 'ambiguous' }` — and `onStale` receives it as a second argument
beside the bare list it always got, so a host that only wants to know *that* something went stale
does not have to unwrap every entry. A tie only survives when the context cannot break it:
`prefix` and `suffix` score a point each and a named `block_id` outranks both, so the three things
that disambiguate an `edit_document` find disambiguate this one too.
