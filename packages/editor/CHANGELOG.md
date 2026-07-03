# @delightstack/editor

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
