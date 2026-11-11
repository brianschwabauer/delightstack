---
'@delightstack/utilities': patch
---

Tooltips sit on `--layer-tooltip` (700) instead of a fixed `z-index: 100`, so a tooltip on a control inside a popover, modal or drawer, or on the button that opened one, is no longer drawn behind the panel.
