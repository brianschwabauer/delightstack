---
'@delightstack/crdt': patch
---

Binding coverage for attribute-only edits

Tests only — no behaviour changed. The ProseMirror binding was proved for text, marks, structure
and undo, and never for an edit that changes **only a node's attributes**, which is what a node
view editing an attr-backed field (a callout's title, an image's caption) produces on every
keystroke.

Six cases, and each one names a guarantee a consumer is entitled to rely on: an attr-only edit is
**one Loro operation** and reaches the other peer as a **markup step rather than a replacement**
(a replacement would throw away every cursor inside the block); two peers changing **different
keys** of one node's attributes keep both, because the attributes are a `LoroMap` and merge per
key; two peers changing the **same** key converge on one winner rather than diverging; and an
attr change is its own undo step, which undoes without touching the key the other peer wrote.

`TEST_SCHEMA` gains a `callout` node — a block with more than one attribute worth changing on its
own — so the fixture has the shape the case actually arises in.
