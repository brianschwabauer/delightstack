# @delightstack/editor

## 1.2.0

### Minor Changes

- aa84486: `@delightstack/crdt/prosemirror`: a hand-written Loro ⇄ ProseMirror binding

  A new entry point binding a `LoroDoc` to a ProseMirror `EditorState`. It lives in the CRDT
  package, not the editor, so `@delightstack/editor` never takes a wasm dependency;
  `prosemirror-model` and `prosemirror-state` are optional peers, so `/server` and `/client`
  bundles never see ProseMirror either.

  `loro-prosemirror` was the reference, not the implementation. Four things it does
  differently, each of which had to be a rewrite rather than a patch:

  - **Writes are reconciled, not rewritten.** Typing one character emits one Loro operation.
    Replacing a paragraph's text container because a character changed would destroy every
    concurrent edit inside it and mint a fresh container per keystroke.
  - **Remote changes arrive as minimal ProseMirror steps.** The projection reuses the same
    node objects for untouched subtrees, so the diff finds the changed range by reference
    comparison — not `tr.replace(0, doc.content.size, …)`, which throws away decorations and
    node views on every remote keystroke.
  - **The caret is anchored _before_ the import and restored in the same transaction.**
    Upstream builds its Loro `Cursor` from the absolute position after importing, so it
    anchors to whichever character slid into that offset, then restores a tick later in a
    `setTimeout`. Measured: caret at 11, a peer inserts five characters at 0, caret still
    reads 11 and the next keystroke lands mid-word. It now reads 16.
  - **Undo is Loro's `UndoManager`, scoped to the local peer.** `prosemirror-history`'s stack
    is a list of steps applied to _this editor_, including a collaborator's paragraph and an
    agent's rewrite, so `Cmd+Z` deletes someone else's work. Peer scoping alone is not enough:
    undoing an operation that _created a container_ deletes the container, and a deleted
    container takes every concurrent edit inside it. So containers are created in their own
    commit under an origin the undo manager excludes, and an undo step holds only the
    characters somebody typed. Undoing block creation still removes the block — that is a
    structural edit the user made.

  Also exported: `pmDocFromLoro` / `writePmDocToLoro` for a `pm_doc` projection with no editor
  attached, `pmDocAtFrontier` + `restorePmDoc` for restoring a version that survived
  compaction only as a snapshot (the server's `revertTo` cannot reach those), and
  `crdtBindingFromDoc` for driving a bare `LoroDoc`.

  **`@delightstack/editor`:** the `history` factory may now return a `HistoryImplementation`
  (`{ plugins, undo, redo, canUndo, canRedo }`) instead of a bare `Plugin[]`. It takes over
  `Mod-z`/`Mod-y`/`Mod-Shift-z`, `undo()`, `redo()`, `can_undo` and `can_redo` as a set —
  previously a factory replaced the plugin but left the commands and the reactive flags
  pointing at a `prosemirror-history` that was no longer installed, so the toolbar reported
  an undo depth of zero and `editor.undo()` silently did nothing. Existing `history` values
  (`false`, an options object, a `Plugin[]` factory) are unchanged.

## 1.1.0

### Minor Changes

- 830da80: `block_id` now survives a cross-document paste correctly, and `Editor` takes a `doc_id`.

  A block id is only useful if it names exactly one block. The plugin already guaranteed that _within_ one document — it detects duplicate ids after every transaction and regenerates the copy, keeping the id on whichever node existed before. But a block pasted in from a **different** document is not a duplicate of anything locally, so its id passed through untouched, and the same id then named one block here and a different block there. Block references, comment anchors and presence focus all resolve by id, so this is a silent aliasing bug rather than a cosmetic one — and it only shows up once an app edits more than one document, which is exactly when it stops being recoverable.

  Provenance cannot be recovered from the pasted block alone, so it now travels with it: `transformCopied` rewrites each id to `<doc_id>:<block_id>` on the way out, and `transformPasted` keeps the bare id only when the prefix matches this editor's `doc_id`, clearing it otherwise so the existing assignment pass mints a fresh one. An id arriving with no stamp — foreign HTML, or another app writing its own `data-block-id` — is never trusted. `doc_id` defaults to a per-instance id, so an app that does not set it gets regeneration on every paste from elsewhere: the safe direction, since a spurious new id costs an anchor while a spurious shared id corrupts one.

  Ids are now `generateTimestampID({ length: 12 })` rather than a hand-rolled base36 string. The timestamp prefix makes them sort by creation, which structural diff wants anyway, and `generateTimestampID` bumps an internal counter within a millisecond, so a bulk paste cannot collide with itself. Existing ids are opaque strings and keep working.

  Split and join were already correct; there are now tests saying so.

## 1.0.4

### Patch Changes

- Updated dependencies [a3e0a38]
  - @delightstack/utilities@1.2.0
  - @delightstack/components@1.5.2

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
