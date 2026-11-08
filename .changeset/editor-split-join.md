---
'@delightstack/editor': minor
---

Document surgery: `splitAt` and `joinDocuments`

Splitting and joining a **block** were already covered — the block-id plugin has rules for both,
and `backspaceCommand` joins two. Splitting and joining a **document** had nothing, so an app
building a Scrivener-style "split this scene here" gesture had to reimplement cutting a
`Fragment` in two and then get the block-id consequences right on its own.

**`splitAt(doc, pos)`** answers with `{ head, tail }`, two documents of the same type. It cuts
rather than slices, so a position inside a list or a quote gives two halves that are each still a
list or a quote, and a cut inside a textblock splits it into two complete blocks. A position of
`0` or `doc.content.size` gives one empty half rather than throwing — whether that means the
gesture should be refused depends on whether it came from a keystroke or a menu, which is the
app's to know.

A wrapper the cut emptied is dropped rather than handed back — cutting in the gap before a list's
first item would otherwise leave an empty `bullet_list` behind on the head side, and a
`list_item+` node with no items is a document ProseMirror refuses to check, transform or
serialize. The test is the node's own content expression, so an empty paragraph stays.

**`joinDocuments(a, b, options)`** appends `b`'s content to `a`'s and takes `a`'s type and attrs.
`separator` puts blocks between the two, and defaults to nothing: in a block document the blocks
are already separate, and what a scene break or a rule *means* belongs to the app's dialect.
Trailing empty paragraphs are trimmed from `a` first, because a document being typed into ends in
the caret's empty paragraph almost all of the time and that blank block would land exactly at the
seam.

Both are pure — node in, node out, no `EditorState` and no view. That is the point rather than a
convenience: the two halves of a split do not live in the same editor. The head stays where it is
and the tail is written into a document that has no editor open on it at all, which a `Command`
could not have expressed.

**Block ids survive both.** `splitAt` leaves the head's ids untouched and regenerates only those
the tail would duplicate — the block the cut ran through — which is the rule splitting a paragraph
with `Enter` already follows. `joinDocuments` leaves `a`'s alone and regenerates only those of
`b`'s that `a` already uses. An id stays stable wherever it can, and is unique afterwards without
exception.
