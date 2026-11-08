---
'@delightstack/components': minor
---

`Corkboard` — a keyboard-navigable, drag-reorderable card grid.

A flat ordered list laid out as a grid of cards, with the card's content left to a snippet: the
component contributes the grid, the cursor, the selection and the reorder gestures. Dragging a
card — or a multi-selection, which moves as one run in screen order — into a gap calls
`onreorder` with a plan (`ids`, landing `index`, `before`/`after` neighbours) rather than
mutating anything, and the surrounding cards settle with a FLIP animation. A card marked
`droppable` also accepts drops onto its middle half, reported as `ondropinto`.

The keyboard walk is genuinely 2D — `↑`/`↓` step by the laid-out column count, read back off the
cards, so it agrees with whatever CSS decided — and `mod`+arrows perform the same reorders the
drag does. Selection reuses the shared model from `selection.ts` (`shift`/`mod` click,
`shift`+arrows, `mod+a`, `escape`). One tab stop, `aria-current` cursor, a `role="status"`
announcement named by `label_of`, and keys typed into a control inside a card are left alone.

Drop geometry is honest about a grid's whole surface. A pointer over the gaps — between cards,
between rows, in the ragged tail — resolves to the *nearest* slot (`dropFromPoint`: row from y
with ties to the nearer band, gap from the cards' midpoints), not to the end of the list. The
indicator is anchored on the card the pointer's row actually contains, so a slot at a row
boundary draws after that row's last card rather than before the next row's first; and at the
grid's outer boundary — where there is no gap to centre in — the bar draws flush inside the
card's edge instead of overhanging where a scrolling ancestor's `overflow` would clip it.
Keyboard reorders go through `planKeyMove`, which steps a multi-selection from the run's edge —
its last card moving toward the end, its first moving toward the front — so `mod`+arrow on a
selected run means the same move a drag of that run means, never a silent no-op measured from
the cursor's own other half.

The grid arithmetic ships as a pure module beside it — `columnCount`, `arrowTarget`, `moveSlot`,
`planKeyMove`, `insertionIndex`, `planReorder`, `planKeyMove`, `dropOnCard`, `dropFromPoint`.

**Deliberately no barrel export.** Without a `sideEffects` declaration a barrel's modules ride in
whatever chunk imports the barrel (DS-13's passenger tax, measured at 4.3KB gzipped of boot for
this component alone in DelightWrite), so `Corkboard` gets the per-component export path DS-13
asks for from birth: `@delightstack/components/display/Corkboard.svelte` and
`@delightstack/components/display/corkboard-model` are in the `exports` map; the root and
`./display` barrels do not name it.
