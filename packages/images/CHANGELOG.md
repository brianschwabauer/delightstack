# @delightstack/images

## 1.0.5

### Patch Changes

- Updated dependencies [2562f06]
  - @delightstack/database@1.1.0

## 1.0.4

### Patch Changes

- Updated dependencies [2336fca]
  - @delightstack/database@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [ed3a41e]
  - @delightstack/database@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [3450337]
  - @delightstack/database@1.0.2

## 1.0.1

### Patch Changes

- 0c92f48: Type-level fixes so consumer apps typecheck cleanly: the database schema's `Table` constraint no longer degenerates into an impossible `table_definition` union when a field generator's shape is `any`, and `StringFieldInputType` now matches the runtime (`tel` / `datetime-local` instead of `phone` / `datetime`); stripe's `PlanDefinition.entitlements` accepts `readonly string[]`; the images and ai request handles and utilities' `createDevHandle` are now generic over the event so they compose with SvelteKit's `Handle` without casts; the editor package no longer emits an `Editor` component export shadowed by the `Editor` class type (which made the component import type-only for consumers).
- Updated dependencies [4652846]
- Updated dependencies [16f9b7f]
- Updated dependencies [0c92f48]
  - @delightstack/database@1.0.1
  - @delightstack/utilities@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/database@1.0.0
  - @delightstack/utilities@1.0.0
