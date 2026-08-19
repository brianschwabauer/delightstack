---
'@delightstack/editor': minor
---

`block_id` now survives a cross-document paste correctly, and `Editor` takes a `doc_id`.

A block id is only useful if it names exactly one block. The plugin already guaranteed that *within* one document — it detects duplicate ids after every transaction and regenerates the copy, keeping the id on whichever node existed before. But a block pasted in from a **different** document is not a duplicate of anything locally, so its id passed through untouched, and the same id then named one block here and a different block there. Block references, comment anchors and presence focus all resolve by id, so this is a silent aliasing bug rather than a cosmetic one — and it only shows up once an app edits more than one document, which is exactly when it stops being recoverable.

Provenance cannot be recovered from the pasted block alone, so it now travels with it: `transformCopied` rewrites each id to `<doc_id>:<block_id>` on the way out, and `transformPasted` keeps the bare id only when the prefix matches this editor's `doc_id`, clearing it otherwise so the existing assignment pass mints a fresh one. An id arriving with no stamp — foreign HTML, or another app writing its own `data-block-id` — is never trusted. `doc_id` defaults to a per-instance id, so an app that does not set it gets regeneration on every paste from elsewhere: the safe direction, since a spurious new id costs an anchor while a spurious shared id corrupts one.

Ids are now `generateTimestampID({ length: 12 })` rather than a hand-rolled base36 string. The timestamp prefix makes them sort by creation, which structural diff wants anyway, and `generateTimestampID` bumps an internal counter within a millisecond, so a bulk paste cannot collide with itself. Existing ids are opaque strings and keep working.

Split and join were already correct; there are now tests saying so.
