---
'@delightstack/components': patch
---

`BottomSheet`: content taller than the highest snap point scrolls by touch again. A sheet whose top snap was under the full screen height (the common `[0.6, 0.95]`) never counted as fully open, so its content kept `touch-action: pan-x` and an upward swipe dragged the sheet instead of scrolling; the panel was also as tall as the screen, so its last few percent sat off the bottom edge. The panel is now capped at the top snap's height, which makes that snap "fully open" and lines the scroll area up with the bottom of the screen. Also: a sheet with `blocking={false}` no longer sets `aria-modal`, so screen readers can still reach the page behind it.
