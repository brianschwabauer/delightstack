---
'@delightstack/editor': minor
---

Bindings an app can replace, and the block commands its palette needs

**`keymap`** — a factory on the editor options, handed `{ schema, editor }`, returning bindings
that install **ahead** of the package's own. It is `input_rules` for keystrokes, and it exists for
the same reason: an app with its own dialect disagrees with a shipped default and previously had
nowhere to say so. `plugins` appends *after* the keymaps, so a binding added there was shadowed by
the one it meant to replace; block keymaps bind first but belong to a block. The concrete case is
headings — the shipped `Mod-Alt-1` is a level-2 heading, because h1 is the page title in this
package's model, and an app whose `#` means level 1 needs its keys to agree with its typing
shortcuts. Anything the factory does not name keeps exactly what it ships with, and `Mod-z` still
belongs to whatever the `history` option installed.

**`moveBlock`, `duplicateBlock`, `insertLine` and `deleteLine` are exported.** They were bound by
the shipped keymap and reachable no other way, so an app listing "Move block up" in a command
palette had to reimplement it — two spellings of one command, drifting apart on the first fix.
No behaviour changes: the keymap binds the same functions it always did.

**`wrapIn` and `lift` are exported too.** `toggleBlockType` is `setBlockType` underneath, and
`setBlockType` *throws* on a node that is not a textblock — so it is not the toggle for a
blockquote or a callout, and there was no other one. The pair that builds it belongs to
`prosemirror-commands`, which a host reaches only through this package; re-exporting them is
cheaper than every host taking a direct dependency to write six lines.
