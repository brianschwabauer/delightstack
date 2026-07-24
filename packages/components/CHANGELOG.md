# @delightstack/components

## 1.1.0

### Minor Changes

- fc32c0c: CommandPalette supports async command sources and external query control. A new `onquery` callback fires whenever the search query changes so a parent can fetch results from a server (debouncing is the parent's responsibility). Commands marked `dynamic: true` are treated as pre-filtered by their source: while a query is present they bypass the fuzzy filter and render, in the order given, after the scored static matches — title highlighting still applies to confident (non-fuzzy) matches. A `loading` prop shows "Searching…" instead of "No results found" while an external source is in flight. The `query` is now a bindable prop so a parent can prefill it (e.g. from a deep-link URL param) or mirror it into the URL; it resets when the palette closes rather than when it opens, so a prefill set alongside `open = true` survives.

### Patch Changes

- 12d7e4b: Fix low-contrast action-colored text and icons (most visibly in dark mode) when the brand seed is dark. `--color-action` is a _surface_ token — its lightness is clamped to a mid band (dark 0.4–0.6) so it reads as a fill under `--color-action-text`. Several components were using it directly as a **foreground** color on the neutral page/card background, which only stays legible when the seed happens to be light: the default `#10a6c4` seed squeaks past AA at ~4.9:1, but a dark seed lands at the clamp floor and drops to ~2:1 (failing WCAG AA).

  New semantic tokens `--color-action-fg` / `--color-accent-fg` (styles) provide a lightness-lifted foreground — the same lift the outline `Button` already applies to its own text — so accent text/icons stay ≥4.5:1 regardless of how dark `--color-primary` is. Components now use them wherever action/accent is text or an icon on a neutral surface: `Tabs` (active label + underline indicator), `Callout` (icon/title/dismiss/accent-bar, via a derived `--callout-fg`), `Stat`, `Code`, `PDF`, `Table` (pending status), `Fieldset` (hover), `FileUpload` (browse link), and `Toast` (info/loading). Paired backgrounds, borders, and focus rings still use `--color-action` unchanged.

- b8e988d: Button labels no longer wrap onto multiple lines when a flex container squeezes the button (`white-space: nowrap` on the base style). SplitPane pane bases now account for the divider's fixed 4px cross size — previously the two panes summed to a full 100% with grow/shrink locked to 0, pushing the second pane past the container's `overflow: hidden` edge and clipping ~4px of its content (e.g. right-aligned buttons losing their rounded corner); collapsed states reserve the divider space too.
- 96ab89a: CommandPalette's search input no longer shows a stray focus ring. The global `*:focus-visible` rule puts a 1px `box-shadow` on any keyboard-focused element, and the palette auto-focuses its input on open — the input reset `border` and `outline` but not `box-shadow`, so the ring drew an awkward box inside the already-framed palette. The input-wrapper's bottom border remains the focus cue.
- 2cedf54: Bug fixes across the library: Modal no longer fires `onclose` twice when closed via Escape/backdrop/X; Calendar guards `time_slot_interval <= 0` instead of freezing the tab; Avatar no longer crashes on whitespace-only names; Breadcrumbs escapes `<` in its JSON-LD script so item labels can't inject markup (XSS); Timeline infinite scroll re-arms after each load instead of firing exactly once; pie/donut Chart legends now toggle individual slices (they previously toggled datasets, leaving single-dataset legends inert); Steps unregisters steps on unmount so dynamic step lists keep correct indices; PDF download handles typed-array sources correctly. Context-driven components (ButtonGroup, Accordion, List, Timeline, Steps, Radio, Fieldset, FileUpload, Tabs, CommandPalette) now expose live prop values through their contexts instead of mount-time snapshots, so prop changes propagate to children without a re-sync tick.
- 90a9b4b: ContextMenu keeps its items mounted while the popover plays its close animation — previously the list unmounted the instant the menu state cleared, leaving an empty panel visibly scaling out. Breadcrumbs crumb Buttons (and the skeleton cells) now inherit the nav's `size-N` font instead of pinning `--control-font-1`, so at any non-default size the clickable crumbs match the current-item span; the current item's inline padding also now matches the sibling buttons (0.55em, 0.4em when dense).
- 0549bda: Press (`:active`) effects on large, full-width elements (Table rows, ListItems, Tree rows, Accordion headers, CommandPalette items, Select options) now use a two-axis scale instead of a uniform ratio: horizontally the element gives up a fixed `--press-shrink` (new token, default 20px) of width no matter how wide it is — computed as `1 - tan(atan2(var(--press-shrink), 100cqi))` — so a full-page row's edges never pull in by ~9% of a huge width; vertically it squashes by `--press-scale-y` (new token, default 0.85), which is what makes the press read as a press. All of these also share a consistent 2px downward nudge. Small controls (Button, chips, Tabs, Checkbox, etc.) are unchanged. Table's drag-lift start scale mirrors the new formula from the scroller width. Accordion headers now also play the standard ripple on click, matching ListItem/Button.
- 7d80054: Fix `Popover` mispositioning after re-anchoring: when `ref_element` changed while the popover was open, the previous element kept its `anchor-name` (it was only cleared on outro-end). With several elements sharing the popover's anchor name, CSS anchor positioning resolves to the last one in DOM order, so the panel could attach to a stale element — while the JS-positioned arrow still pointed at the current one. The anchor-name is now released from the old element the moment the popover re-anchors; closing still keeps it through the outro.
- 6596fd5: Tabs: vertically center the tab badge count. The badge flex-centers its content's line box, but a digit's ink sits low inside a `line-height: 1` box (the font's ascent+descent overflow it asymmetrically), so the number read a hair low. The count is now wrapped in an inner element trimmed with `text-box-trim: trim-both; text-box-edge: cap alphabetic`, so the box hugs the glyph and the flex centering lands on the ink itself. Progressive enhancement — browsers without `text-box` support keep the previous rendering.
- Updated dependencies [12d7e4b]
- Updated dependencies [0549bda]
- Updated dependencies [0c92f48]
  - @delightstack/styles@1.1.0
  - @delightstack/utilities@1.0.1

## 1.0.1

### Patch Changes

- 7334e7a: Input: make props and modes compose correctly. Autocomplete now works in `multiple` (chips) mode — typing in the chip draft opens and filters the panel (static `options` and async `onfilter`), Enter/click adds the suggestion as a chip (falling back to a raw chip when nothing matches), the panel stays open for picking several in a row, and already-added options are hidden. Also fixed: `multiple` with an undefined initial value fell through to a plain text input; `readonly` chips could still be removed via the remove button or Backspace; `type="number"` + autocomplete never opened the panel while typing and selection stuffed a label string into the numeric value; panel selection didn't sync the Form context value; the floating label overlapped an uncommitted chip draft on blur; and `maxlength`/`show_counter`/`mask`/`clearable` now apply to the chip draft. The chip input also gained the combobox ARIA wiring the single input already had.

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). Also surfaces `@delightstack/editor` in the agent-facing `SKILL.md` (adds an editor callout under "Beyond components") and fixes a stale `/stack/overview.md` docs link left over from the 2026-06 docs restructure.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/styles@1.0.0
  - @delightstack/utilities@1.0.0

## 0.2.0

### Minor Changes

- **Number stepper — compact footprint:** the increment/decrement buttons keep their full-size (~field-height) touch targets but pull together and into the field's end padding, roughly halving the pair's visual width.
- **Select — empty option values:** an option whose value is `''`, `null`, or `undefined` now empties the field. At rest the trigger reads as unselected (fixing the label/value double-render when the value matched an empty-string option); while the label is floated, the chosen empty option's label shows placeholder-styled so picking e.g. "None" gives visible feedback instead of looking like a no-op.
