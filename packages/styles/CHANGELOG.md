# @delightstack/styles

## 1.3.0

### Minor Changes

- ba8a51d: One "selected" colour: new `--color-selected-bg` and `--color-selected-text` tokens (a tint of the action colour by default) style every selected state. An `active` uncoloured Button (outline, transparent, translucent), the chosen option of a ButtonGroup and an `active` ListItem now match, instead of three different grey washes; the accent/error/success/warning variants keep their own colour. A selected ListItem no longer looks like a hovered one (both were the same 6% wash), and hovering it keeps its selected colour.

## 1.2.1

### Patch Changes

- fb1fb4b: ListItem's ripple now lives inside the row that the press scales, so the ripple and the highlight shrink together instead of showing two different boxes. Checkbox and Radio play their spring animation whenever their state changes, including when a parent sets it (List's checkbox and radio modes, "select all", a group value set from outside). Radio's reduced-motion rules now cover a standalone Radio too. tokens.css turns off the mobile tap-highlight box for the whole page.

## 1.2.0

### Minor Changes

- d5e18d9: Two accessibility fixes in the token layer, both found by measuring rather than by looking.

  **`--color-error-fg`, `--color-warning-fg` and `--color-success-fg`.** The three feedback colours
  were surfaces with no foreground counterpart, which left every consumer wanting a red failure line
  with two options and neither of them legible: `--color-error` measures 3.82:1 as small text on the
  light page ground and 3.59:1 on a warmer one, and `--color-warning` is **2.10:1 and 1.97:1** —
  against a 4.5:1 floor; `--color-error-text` is derived at 96% lightness for the _filled_ surface
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
  a decoration where the replacement should be — and it is the _default_, so what it left uncovered
  was every control nobody had thought about, which is exactly the set a keyboard user gets stranded
  in. It is now a 2px `--color-action` outline at a 1px offset (4.78:1 – 5.27:1). An outline rather
  than a box-shadow, so it survives `overflow: hidden` and follows `border-radius`.

  **Migration — one line, and it is not the one you would guess.** A component that draws its own
  focus ring with a `box-shadow` must also declare `outline: none` in that rule (or in a rule for the
  same element that outranks `*:focus-visible`). Specificity alone does **not** save it: the two rules
  set _different properties_, so a higher-specificity `box-shadow` ring does not displace the global
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

- a6807b5: Design audit of the token layer.

  - **Contrast:** status fills (`--color-error`, `--color-success`) and the dark-mode action color now pass WCAG AA with their text in both schemes, and form controls get a new `--color-border-control` that meets the 3:1 boundary rule (the decorative `--color-border` doesn't). Success shifts slightly toward blue-green.
  - **Accent is an ink color:** near-black in light mode, near-white in dark, instead of a muted brand tint that read as disabled.
  - **Warning** gains `-disabled`, `-active` and `-text*` tokens so it works as a button color.
  - **Shadows are light-mode only.** In dark mode every `--shadow-*` layer is transparent; raised surfaces separate from the page with a 1px outline instead.
  - **Type and motion:** small text sizes nudged up, `--space-2-5` (12px) added, `--ease-default`/`--ease-out` are now quart-out, and `--ease-out-strong` (quint-out) and `--ease-settle` are new.

## 1.1.2

### Patch Changes

- 58bc069: Text selected inside a field — `input`, `textarea`, a `contenteditable` editor — is a light tint of the
  action color with the normal text color, instead of the page's full action fill. Select-all on focus
  (and a double-click) covered the whole value, and the floated label beside it, in a hard block.

## 1.1.1

### Patch Changes

- 2dc1c9c: Selected Button and focused field contrast:

  - Selected (`active`) outline and transparent Buttons get their own, deeper wash instead of sharing the hover tint. They no longer look merely hovered in a ButtonGroup, and they stay visible with a dark brand color in dark mode. Hovering a selected button no longer fades it back to the hover tint.
  - Icon-only end buttons in an attached ButtonGroup split their extra width across both sides (slightly more on the rounded end), so the icon sits centered in its segment instead of being pushed toward the group's middle.
  - Input and Select draw their focus border and floated label in `--color-action-fg` instead of `--color-action`, so focusing a field brightens it in dark mode rather than dimming it.

## 1.1.0

### Minor Changes

- 12d7e4b: Fix low-contrast action-colored text and icons (most visibly in dark mode) when the brand seed is dark. `--color-action` is a _surface_ token — its lightness is clamped to a mid band (dark 0.4–0.6) so it reads as a fill under `--color-action-text`. Several components were using it directly as a **foreground** color on the neutral page/card background, which only stays legible when the seed happens to be light: the default `#10a6c4` seed squeaks past AA at ~4.9:1, but a dark seed lands at the clamp floor and drops to ~2:1 (failing WCAG AA).

  New semantic tokens `--color-action-fg` / `--color-accent-fg` (styles) provide a lightness-lifted foreground — the same lift the outline `Button` already applies to its own text — so accent text/icons stay ≥4.5:1 regardless of how dark `--color-primary` is. Components now use them wherever action/accent is text or an icon on a neutral surface: `Tabs` (active label + underline indicator), `Callout` (icon/title/dismiss/accent-bar, via a derived `--callout-fg`), `Stat`, `Code`, `PDF`, `Table` (pending status), `Fieldset` (hover), `FileUpload` (browse link), and `Toast` (info/loading). Paired backgrounds, borders, and focus rings still use `--color-action` unchanged.

### Patch Changes

- 0549bda: Press (`:active`) effects on large, full-width elements (Table rows, ListItems, Tree rows, Accordion headers, CommandPalette items, Select options) now use a two-axis scale instead of a uniform ratio: horizontally the element gives up a fixed `--press-shrink` (new token, default 20px) of width no matter how wide it is — computed as `1 - tan(atan2(var(--press-shrink), 100cqi))` — so a full-page row's edges never pull in by ~9% of a huge width; vertically it squashes by `--press-scale-y` (new token, default 0.85), which is what makes the press read as a press. All of these also share a consistent 2px downward nudge. Small controls (Button, chips, Tabs, Checkbox, etc.) are unchanged. Table's drag-lift start scale mirrors the new formula from the scroller width. Accordion headers now also play the standard ripple on click, matching ListItem/Button.

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.
