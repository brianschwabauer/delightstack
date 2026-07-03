# @delightstack/components

## 0.2.0

### Minor Changes

- **Number stepper — compact footprint:** the increment/decrement buttons keep their full-size (~field-height) touch targets but pull together and into the field's end padding, roughly halving the pair's visual width.
- **Select — empty option values:** an option whose value is `''`, `null`, or `undefined` now empties the field. At rest the trigger reads as unselected (fixing the label/value double-render when the value matched an empty-string option); while the label is floated, the chosen empty option's label shows placeholder-styled so picking e.g. "None" gives visible feedback instead of looking like a no-op.
