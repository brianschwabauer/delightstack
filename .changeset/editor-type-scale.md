---
'@delightstack/editor': minor
---

The editor's type scale and vertical rhythm are now `--editor-*` custom properties — heading
sizes, weight, leading and tracking; `pre` and inline `code` size, ground, radius, padding and
leading; the blockquote rule and its indent; the list indent; and the gaps between blocks, around
headings, between list items and before a nested list. Every default is the value that was
hard-coded before, so nothing changes for a consumer that sets none of them.

`undoInputRule` is re-exported from `prosemirror-inputrules` alongside the four rule helpers
already there — it is what the package's own `Backspace` is chained from, so an app can test that
one press undoes a rule it wrote against the real command.

This exists for a host that renders the same document twice — a read-only projection before the
editor mounts, and the editor after. The editor's rules are written as `.editor .ProseMirror h1`,
three classes, which outranks a host's own container selector; before this there was no way for a
host to declare the type once and have both states agree, so every heading, code block and quote
resized the instant the editor mounted. `--editor-line-height` already worked this way and is why
the leading survived; this is the rest of the scale, and the rhythm, the same way.

One rule became two on the way: `li + li, li > ul, li > ol` is now `li + li` and `li > ul, li > ol`
with a property each, because a nested list is a block inside its item rather than another item.
