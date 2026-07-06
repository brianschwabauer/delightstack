# @delightstack/components

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
