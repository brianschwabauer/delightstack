---
'@delightstack/styles': minor
---

Two accessibility fixes in the token layer, both found by measuring rather than by looking.

**`--color-error-fg`, `--color-warning-fg` and `--color-success-fg`.** The three feedback colours
were surfaces with no foreground counterpart, which left every consumer wanting a red failure line
with two options and neither of them legible: `--color-error` measures 3.82:1 as small text on the
light page ground and 3.59:1 on a warmer one, and `--color-warning` is **2.10:1 and 1.97:1** —
against a 4.5:1 floor; `--color-error-text` is derived at 96% lightness for the *filled* surface
and lands around 1.05:1 on the page. The new variants use `--color-action-fg`'s clamps verbatim —
`min(l, 0.5)` on light grounds, `max(l, 0.65)` on dark — and measure 4.72:1 – 8.65:1 over twelve
cells (three colours, four themes). The base tokens keep their meaning: a border, a fill, a tinted
ground.

Two things surfaced while measuring, both worth a decision rather than a patch here. The clamps are
now written out a **third** time inside the package — `Callout` re-derives them as `--callout-fg`
to get a legible foreground for its tinted surface — which is what a missing token looks like from
the inside. And `--color-action-fg` on `--color-action-bg` measures **4.48:1** on the light branch,
two hundredths under the floor: a default `Callout`'s title and icon on its own ground. Lifting the
clamp to `min(l, 0.48)` or dropping `--color-action-bg`'s mix from 14% to 13% clears it; neither is
done here, because it changes a colour every consumer already ships.

**A focus ring that can be seen.** `*:focus-visible` was `outline: none` plus a 1px box-shadow in
`--color-border`, which is 1.71:1 against the light page and 1.62:1 against a warm one. WCAG 1.4.11
asks 3:1 of a focus indicator and 2.4.13 asks two pixels of it, so that rule was a suppression with
a decoration where the replacement should be — and it is the *default*, so what it left uncovered
was every control nobody had thought about, which is exactly the set a keyboard user gets stranded
in. It is now a 2px `--color-action` outline at a 1px offset (4.78:1 – 5.27:1). An outline rather
than a box-shadow, so it survives `overflow: hidden` and follows `border-radius`.

**Migration — one line, and it is not the one you would guess.** A component that draws its own
focus ring with a `box-shadow` must also declare `outline: none` in that rule (or in a rule for the
same element that outranks `*:focus-visible`). Specificity alone does **not** save it: the two rules
set *different properties*, so a higher-specificity `box-shadow` ring does not displace the global
`outline` — both apply, and the control gets two rings.

Every component in this package was audited against that rule and **none of them needed changing**:
each one that draws a box-shadow ring already carries `outline: none` on the element, written to
suppress the user-agent ring and now doing double duty (`Checkbox`, `Radio`, `Tabs`, `Table`,
`Tree`, `Accordion`, `Avatar`, `AvatarGroup`, `Calendar`, `Comparison`), and `ListItem`'s rings
hang off inputs that are `opacity: 0`. Verified in a browser against the built stylesheets rather
than by reading the cascade. `Input` and `CommandPalette` were the two whose protection was a
specificity accident — a bare `input` selector outranking `*:focus-visible` by a single element —
and both now restate the suppression on `:focus-visible` so the intent survives a selector change.
`Tree` keeps its `:not(.pointer-focus)` guard on the ring while suppressing the outline
unconditionally, which is what stops a modifier-held multi-select click flashing a ring.
