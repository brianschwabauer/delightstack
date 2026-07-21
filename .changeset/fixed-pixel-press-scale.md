---
"@delightstack/components": patch
"@delightstack/styles": patch
---

Press (`:active`) effects on large, full-width elements (Table rows, ListItems, Tree rows, Accordion headers, CommandPalette items, Select options) now use a two-axis scale instead of a uniform ratio: horizontally the element gives up a fixed `--press-shrink` (new token, default 20px) of width no matter how wide it is — computed as `1 - tan(atan2(var(--press-shrink), 100cqi))` — so a full-page row's edges never pull in by ~9% of a huge width; vertically it squashes by `--press-scale-y` (new token, default 0.85), which is what makes the press read as a press. All of these also share a consistent 2px downward nudge. Small controls (Button, chips, Tabs, Checkbox, etc.) are unchanged. Table's drag-lift start scale mirrors the new formula from the scroller width. Accordion headers now also play the standard ripple on click, matching ListItem/Button.
