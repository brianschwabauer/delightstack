---
'@delightstack/components': patch
'@delightstack/styles': patch
---

ListItem's ripple now lives inside the row that the press scales, so the ripple and the highlight shrink together instead of showing two different boxes. Checkbox and Radio play their spring animation whenever their state changes, including when a parent sets it (List's checkbox and radio modes, "select all", a group value set from outside). Radio's reduced-motion rules now cover a standalone Radio too. tokens.css turns off the mobile tap-highlight box for the whole page.
