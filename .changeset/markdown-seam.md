---
'@delightstack/editor': minor
---

Markdown hooks, and typing shortcuts an app can replace

Two seams, both for the same kind of app: one that has its own markdown dialect and needs the
editor to stop guessing at it.

**`markdown`** — `{ looks_like?, parse?, serialize? }` on the editor options. `parse` handles
plain-text markdown pastes in place of the package's own small parser, and `serialize` writes the
clipboard's `text/plain` on copy and cut. `text/html` is untouched, so a paste back into an editor
still takes the lossless path — which is also why, when a clipboard carries both flavours, HTML
wins.

The two details that make it usable rather than merely present: a parsed markdown paste now goes
through `transformPasted` before it is inserted, exactly as a rich paste does, so the block-id
rules apply to it too and an id off somebody else's clipboard is cleared rather than trusted; and
`serialize` is handed the slice **after** `transformCopied`, so `<doc_id>:<block_id>` stamps are
visible where they can be stripped before they leave the app.

**`input_rules`** — `false` for none, or a factory handed the built-in rules (`baseInputRules`,
now exported) that returns the list to install. Rules run in order and the first to fire wins, so
a rule returned ahead of a built-in shadows it: that is how an app whose `#` means a level-1
heading replaces one shortcut without giving up the dozen it agrees with. `InputRule`,
`textblockTypeInputRule` and `wrappingInputRule` are re-exported so writing a dialect's rules
needs no direct dependency on `prosemirror-inputrules`.

A block's own `input_rules` are unchanged and still additive, and an editor built without either
option installs the same plugins it did before.

**Two behaviour changes that reach every consumer**, both on the plain-text markdown paste path
and both fixes:

- A parsed markdown paste now goes through `transformPasted`, where before it went straight to
  `replaceSelection`. Block ids on pasted markdown are regenerated rather than kept.
- A parse that produces exactly **one paragraph** is now inserted into the textblock the caret is
  in, not as a block of its own. `` `code` `` or `[text](href)` pasted into the middle of a
  sentence used to split the paragraph in three; it no longer does. A heading, a list, or more
  than one block still pastes as blocks.
