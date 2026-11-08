---
'@delightstack/editor': minor
---

Annotation decorations for highlights the host owns — `annotationDecorations()`, plus
`resolveAnnotations`, `annotationCommands`, `annotationsInDocument`, `focusedAnnotation`,
`annotationAnchorAt`, `nextAnnotation` and `previousAnnotation`. And, underneath both this and the
tracked-changes plugin, a shared re-anchoring core: `resolveAnchors()`.

A reader drags over a passage and it stays marked, in one of the host's colours, with an optional
note beside it. **An annotation is not a mark**, and that is the whole design rather than an
implementation detail: a mark lives in the document, so highlighting somebody else's article would
be an *edit* to it — in the history, in every device's sync queue, on a body the reader never meant
to touch. So the host keeps a row and this plugin draws it, exactly the way `suggestionDecorations`
draws a proposal, and for the same reason. Nothing here writes to the document.

That decision settles the addressing without a second one being needed. A row cannot hold a
position — the document moves and the row does not, and the reader who made the highlight was on
another device six weeks ago. An annotation is `{block_id, quote, prefix, suffix}` and is re-found
on every document change. Edit around a highlight and it follows its sentence; delete the sentence
and it goes stale, which is reported through `onStale` and never dropped, because the quote is
still the reader's.

**`resolveAnchors(doc, items, anchorOf)` is new and is where the finding now lives.** Two features
arriving at one algorithm is the case for extracting it: the block-text padding that keeps offsets
real across inline atoms, the NFC/NFD spellings, the partial context score that lets a nearby edit
degrade a match instead of erasing it, the home bonus that makes a named block outrank the rest of
the document, and the refusal to let document order break a tie. It is generic in the caller's row
type through an `anchorOf` projection, and `TextAnchor`, `ResolvedAnchor<T>`, `StaleAnchor<T>` and
`HOME_BONUS` are exported for a host with anchored rows of its own — a comment thread, a bookmark.

`suggestionDecorations` is refactored onto it with **no change to its surface**: `resolveSuggestions`
still answers with `{resolved, stale, stale_details}`, `ResolvedSuggestion` still carries `kind`,
and the whole of its existing test suite passes untouched.

The differences between the two plugins are each deliberate. An **empty quote is refused** where an
empty `find` is a legitimate pure insertion — a highlight over nothing would be a zero-width mark
nobody can see, click, or remove. The highlight is an inline decoration and nothing else, carrying
`role="mark"`, which matters here more than usual because colour is the entire visual signal and a
listener gets none of it. A click is caught through `handleClick` rather than a DOM listener, since
an inline decoration's DOM is the paragraph's own text nodes and there is nothing of ours to bind
to; it returns `false`, because selecting a highlight is not handling the click and the caret
should still go where the reader put it. Overlapping highlights resolve innermost first: a phrase
marked inside an already-marked paragraph is the one that was meant.

Colour is a class (`ds-annotation-<color>`) and never a value, because the palette belongs to the
host — anything that is not a short run of word characters is dropped rather than escaped, since a
colour is a palette entry's *name*. `--editor-annotation-*` custom properties carry defaults for
five, so a consumer that sets nothing still gets a highlighter; light and dark are different
pigments at the same hue rather than one wash at two alphas, because a pale yellow over a
near-black page is a bright bar that inverts the page wherever it appears.

`annotationAnchorAt(state)` is exported because *making* an annotation is the host's and every host
would otherwise write the same twenty lines slightly differently — which is fatal here: it records
offsets into the same padded block text the resolver searches, so a highlight made now is a
highlight found later. Its context comes from the block rather than the document, since a prefix
that ran into the previous paragraph would stop matching the moment either paragraph moved.

The note glyph is a widget, isolated with `stopEvent` and `ignoreSelection` — a widget's DOM lives
inside the contenteditable, and without that the Enter that opened the note would also reach the
keymap.

No keys are bound; the focus and edit commands are exported for the host's own keymap. One
difference from `nextSuggestion` worth knowing: while nothing is explicitly focused, `nextAnnotation`
and `previousAnnotation` move *to* the highlight at the caret rather than past it. Stepping through
a review queue and reaching the thing you are standing in are different gestures.

`resolveAnchors` takes an optional `AnchorCache` (`createAnchorCache()`), and both plugins keep
one. It exists for a cost that is easy to miss: an anchor that *resolves* is cheap, because the
recorded block answers and the search stops — but an anchor that has gone **stale** finds nothing
there and falls through to scanning every other block, and does it again on the next keystroke.
Twenty stale anchors over a long document measured 3.7ms per keystroke, all of it re-deciding a
fact that had not moved.

The cache rests on one observation: a missing anchor can only come back in a block that *changed*.
If an unchanged block held the text, it would not have been missing. So a previously-missing anchor
is scanned against the blocks whose nodes are new — after a keystroke, one of them — and if it is
still absent it is still missing, without the document being walked. Measured at 2.17ms → 0.16ms
for that case. It deliberately caches neither `ambiguous` (a whole-document fact: deleting one of
two identical paragraphs elsewhere resolves it) nor anything that resolved (whose range moves with
every edit before it, and which was never the expensive case). Invalidation is by **node identity**
rather than a version counter a caller could forget to bump — ProseMirror nodes are immutable, so a
block that survived a transaction is the same object — which also means a cache handed a different
document simply sees every block as new and takes the slow path.

`annotationAnchorAt` now reports whether it clamped. A selection that runs past the end of its
block is truncated to it, because an annotation is anchored inside one block and a quote spanning a
paragraph boundary would have to survive both — but dragging across two paragraphs is an ordinary
thing to do, so the clamp is reported (`truncated: true`, on the new `AnnotationAnchor` type)
rather than applied in silence. Silently highlighting the first third of what somebody dragged over
is the kind of thing they notice much later and cannot explain.
