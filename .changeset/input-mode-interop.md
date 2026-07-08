---
"@delightstack/components": patch
---

Input: make props and modes compose correctly. Autocomplete now works in `multiple` (chips) mode — typing in the chip draft opens and filters the panel (static `options` and async `onfilter`), Enter/click adds the suggestion as a chip (falling back to a raw chip when nothing matches), the panel stays open for picking several in a row, and already-added options are hidden. Also fixed: `multiple` with an undefined initial value fell through to a plain text input; `readonly` chips could still be removed via the remove button or Backspace; `type="number"` + autocomplete never opened the panel while typing and selection stuffed a label string into the numeric value; panel selection didn't sync the Form context value; the floating label overlapped an uncommitted chip draft on blur; and `maxlength`/`show_counter`/`mask`/`clearable` now apply to the chip draft. The chip input also gained the combobox ARIA wiring the single input already had.
