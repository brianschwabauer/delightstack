# @delightstack/editor

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
