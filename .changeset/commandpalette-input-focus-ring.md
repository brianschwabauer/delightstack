---
"@delightstack/components": patch
---

CommandPalette's search input no longer shows a stray focus ring. The global `*:focus-visible` rule puts a 1px `box-shadow` on any keyboard-focused element, and the palette auto-focuses its input on open — the input reset `border` and `outline` but not `box-shadow`, so the ring drew an awkward box inside the already-framed palette. The input-wrapper's bottom border remains the focus cue.
