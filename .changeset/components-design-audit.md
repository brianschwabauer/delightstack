---
'@delightstack/components': minor
---

Design audit across the component set.

- **New:** `Button` `warning` color and `value` prop; `ButtonGroup` segmented mode (`bind:value`, optionally `translucent` for a neutral selected chip); `Table` `column_dividers` (row dividers only by default, softer than the frame); `Stat` `positive="down"` for metrics where lower is better.
- **Fixes:** hover popovers no longer trap focus; chart lines reach their last point; the command palette highlights the row Enter will run; Rating's half stars lose their seam; DiffViewer aligns line numbers and spaces changed words; the menu-button chevron renders; trailing icons in `Input`/`Select` sit as far from the right edge as from the top and bottom; overlapping `AvatarGroup` skeletons no longer show through each other; `ContextMenu` renders once even when mounted several times.
- **Toast:** the close button is a small bubble in a "liquid" notch cut into the card's corner (drawn as one SVG shape so the outline follows it).
- **Polish:** dark-mode surfaces use outlines instead of shadows, tab indicators ease out without overshoot, reduced-motion handling in the remaining animated controls, Calendar, Steps, Avatar, Callout, Progress, Pagination and Code refinements.
