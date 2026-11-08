---
'@delightstack/editor': minor
---

Passive term decoration — `termDecorations()`, a plugin that decorates every occurrence of an
externally-owned term set (a glossary, a character register, a linter's word list) *passively*:
invisible until revealed, a managed modifier-key reveal class, and a modifier-click activation
callback that hands back the term's id. Decorations only, on the same footing as
`suggestionDecorations`, `annotationDecorations` and `focusDim` — nothing here writes a
transaction, enters the history, or survives serialization.

The matcher is a **seam, not a built-in**. ED-09 was filed asking for a zero-dependency
Aho–Corasick inside the package; what shipped is narrower: the host hands `match(text)` and the
plugin owns everything positional. Matching rules — per-term case sensitivity, word boundaries
beyond ASCII, possessives — are the host's dialect, and a host with a server-side matcher must
decorate with the same code rather than this package's opinion of it. A `RegExp` over a short
list is a perfectly good `match` for a glossary.

The positional contract: each textblock hands `match` one string whose index `i` is exactly the
ProseMirror position `block_start + 1 + i` — text nodes contribute their characters, any other
inline child contributes U+FFFC per position it occupies (a hard word boundary), and text under
a skipped mark (inline `code` by default) is masked to spaces of the same length; code blocks
are skipped entirely (`termBlockText` is exported so hosts and tests can agree on exactly what
was matched). Offsets come back and are spent as positions verbatim. Only the textblocks a
transaction touched are re-matched; everything else is mapped. `setTermDecorations(view,
{ refresh: true })` re-matches the whole document when the term set changes; `{ always_on }`
toggles the always-shown root class.

The package ships **no styles**: decorations carry `ds-term` (or `class_name`) plus
`data-term-id`, and the editor root carries `ds-terms-reveal` while the modifier is held and
`ds-terms-always` while `always_on` is set — the host's CSS decides what a revealed term looks
like. When decorated ranges overlap, a modifier-click activates the narrowest one under the
pointer. No keys are bound.
