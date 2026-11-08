---
'@delightstack/components': patch
---

`Modal`: on a phone the body's side padding is 1rem instead of 0.5rem, so fields and text sit at the usual 16px gutter rather than 8px from the screen edge. The in-flow footer's negative margin follows, so its divider still runs edge to edge.
