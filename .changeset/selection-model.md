---
'@delightstack/components': minor
---

Multi-select: a shared selection model

A shared selection model, so a list-shaped component gets the whole multi-select gesture set
without reinventing the part everyone gets wrong.

**`selection.ts`** — a pure model, exported as `applySelection`, `extendSelection`,
`selectionGestureOf`, `selectionSelectAll`, `clearSelection`, `selectionFromIDs` and
`EMPTY_SELECTION`. No runes, no DOM: a caller passes the state it holds, the ids on screen
in the order they are on screen, and the gesture, and gets a new state back. That makes it
usable from `Tree`'s `$bindable` array, from `Table`'s row selection or from a consumer's
own state, and it makes the rules testable without mounting anything.

The part it exists for is the **anchor**. A range is measured from the item the user last
committed to, and that item stays put while shift-clicks re-range around it — so a second
shift-click narrows the range instead of ratcheting it outward, which is what happens when
"the last id in the array" is treated as the anchor. `mod`-click moves the anchor even when
it deselects, because the next range is measured from the last thing pointed at whether or
not it survived the click.

**`Tree`** now uses it whenever `multi_select` is set, which adds the keyboard half of
multi-select to the pointer half it already had: `shift+↑/↓` extends the range from the
cursor, `mod+a` selects everything visible, and `escape` clears — claimed only when there is
a selection to drop, so `escape` still reaches the drawer or modal the tree is inside the
rest of the time. Selected ids now come back in screen order however the selection was
built, and a range no longer keeps rows outside it.
