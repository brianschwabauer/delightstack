---
'@delightstack/components': patch
---

Tabs: light text on the active tab when `pills` and `boxed` are combined

With both variants on, the active tab is filled with the action color (the pill), but the boxed
variant's dark active text came later in the stylesheet and won, leaving dark text on a dark fill.
The boxed text color now applies only when `pills` is off.
