---
'@delightstack/components': patch
---

`Table`: the inline cell editor no longer draws the global focus ring as a stray box inside the cell. It reset `outline` but not the `box-shadow` the global `*:focus-visible` rule draws; the cell's own editing ring is the focus cue.
