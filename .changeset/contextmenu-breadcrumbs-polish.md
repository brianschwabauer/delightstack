---
"@delightstack/components": patch
---

ContextMenu keeps its items mounted while the popover plays its close animation — previously the list unmounted the instant the menu state cleared, leaving an empty panel visibly scaling out. Breadcrumbs crumb Buttons (and the skeleton cells) now inherit the nav's `size-N` font instead of pinning `--control-font-1`, so at any non-default size the clickable crumbs match the current-item span; the current item's inline padding also now matches the sibling buttons (0.55em, 0.4em when dense).
