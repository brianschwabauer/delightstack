---
'@delightstack/crdt': minor
'@delightstack/editor': minor
---

`@delightstack/crdt/prosemirror`: a hand-written Loro ⇄ ProseMirror binding

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
- **The caret is anchored *before* the import and restored in the same transaction.**
  Upstream builds its Loro `Cursor` from the absolute position after importing, so it
  anchors to whichever character slid into that offset, then restores a tick later in a
  `setTimeout`. Measured: caret at 11, a peer inserts five characters at 0, caret still
  reads 11 and the next keystroke lands mid-word. It now reads 16.
- **Undo is Loro's `UndoManager`, scoped to the local peer.** `prosemirror-history`'s stack
  is a list of steps applied to *this editor*, including a collaborator's paragraph and an
  agent's rewrite, so `Cmd+Z` deletes someone else's work. Peer scoping alone is not enough:
  undoing an operation that *created a container* deletes the container, and a deleted
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
