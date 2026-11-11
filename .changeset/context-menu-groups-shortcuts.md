---
'@delightstack/components': minor
---

ContextMenu actions take `shortcut`, `group` and `danger`. `shortcut` (e.g. `['⌘', 'D']`) shows the keys as quiet text on the item's trailing edge. `group` keeps related actions together, and a hairline is drawn wherever the group changes, so an action left out conditionally never leaves a stray divider. `danger` puts a destructive action like Delete in the error color. A menu can also ask for `dense` rows.
