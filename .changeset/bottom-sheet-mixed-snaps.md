---
'@delightstack/components': patch
---

BottomSheet: snap points mixing pixels and fractions now order by the height they resolve to. `[359, 0.9]` used to sort by raw value (0.9 before 359), so the sheet opened at 90% and a drag could never leave the peek.
