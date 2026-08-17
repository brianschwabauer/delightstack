# @delightstack/editor

## 1.0.3

### Patch Changes

- Updated dependencies [d86752e]
  - @delightstack/utilities@1.1.0
  - @delightstack/components@1.5.1

## 1.0.2

### Patch Changes

- b1c1b0e: Bug fixes: inserting multiple files at the selection (paste or multi-select picker) no longer keeps only the last file — each upload placeholder now inserts after the previous one; the block gutter's actions menu re-resolves the block position at action time, so Delete/Duplicate/Move/turn-into can't corrupt the wrong content after edits shift positions; duplicating a block upward no longer transfers the original's `block_id` to the copy (dedupe now maps the pre-existing node's position forward, so anchors stay on the original); `getJSON()` substitutes an empty-paragraph doc instead of emitting a schema-invalid `content: []` while a lone upload is in flight; touch drag can no longer strand itself (stuck drop indicator + runaway auto-scroll loop) when the pointer leaves the container; GalleryBlock aborts in-flight uploads on unmount instead of silently losing them.
- 0c92f48: Type-level fixes so consumer apps typecheck cleanly: the database schema's `Table` constraint no longer degenerates into an impossible `table_definition` union when a field generator's shape is `any`, and `StringFieldInputType` now matches the runtime (`tel` / `datetime-local` instead of `phone` / `datetime`); stripe's `PlanDefinition.entitlements` accepts `readonly string[]`; the images and ai request handles and utilities' `createDevHandle` are now generic over the event so they compose with SvelteKit's `Handle` without casts; the editor package no longer emits an `Editor` component export shadowed by the `Editor` class type (which made the component import type-only for consumers).
- Updated dependencies [12d7e4b]
- Updated dependencies [b8e988d]
- Updated dependencies [fc32c0c]
- Updated dependencies [96ab89a]
- Updated dependencies [2cedf54]
- Updated dependencies [90a9b4b]
- Updated dependencies [0549bda]
- Updated dependencies [7d80054]
- Updated dependencies [6596fd5]
- Updated dependencies [0c92f48]
  - @delightstack/components@1.1.0
  - @delightstack/utilities@1.0.1

## 1.0.1

### Patch Changes

- Updated dependencies [7334e7a]
  - @delightstack/components@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
- Updated dependencies [8420739]
  - @delightstack/components@1.0.0
  - @delightstack/utilities@1.0.0

## 0.2.0

### Minor Changes

- Initial release of `@delightstack/editor` — a ProseMirror-based block editor for Svelte 5.

  - Slash command menu with fuzzy search, plus an add-block (`+`) gutter menu
  - Single gutter drag handle with a gliding drop indicator, per-item drag, and touch reorder
  - Block toolbars that swap into task-specific modes (`BlockSpec.chrome_modes` + `ui.chrome_mode`) instead of overlaying UI on the block
  - Instant selection toolbar with Popover-style menu entrances and motion polish (selection rings, todo pop, reduced-motion support)
  - Media blocks: image crop + focal-point reposition, gallery captions (hidden / on hover / always), click-to-activate embed facades, optimistic uploads
  - Breakout block widths (`normal` / `wide` / `full`) with magnetic resize snaps, tokenized via `--editor-wide-width` / `--editor-full-width`
  - Live syntax highlighting in editable code blocks
  - Responsive sizing, click-below-to-append, a mobile toolbar, and line-editing shortcuts (duplicate, insert, delete, jump)
  - Server-side renderer that emits self-contained markup for published pages
