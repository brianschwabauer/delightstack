# @delightstack/components

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
