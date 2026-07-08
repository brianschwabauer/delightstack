---
"@delightstack/editor": patch
---

Bug fixes: inserting multiple files at the selection (paste or multi-select picker) no longer keeps only the last file — each upload placeholder now inserts after the previous one; the block gutter's actions menu re-resolves the block position at action time, so Delete/Duplicate/Move/turn-into can't corrupt the wrong content after edits shift positions; duplicating a block upward no longer transfers the original's `block_id` to the copy (dedupe now maps the pre-existing node's position forward, so anchors stay on the original); `getJSON()` substitutes an empty-paragraph doc instead of emitting a schema-invalid `content: []` while a lone upload is in flight; touch drag can no longer strand itself (stuck drop indicator + runaway auto-scroll loop) when the pointer leaves the container; GalleryBlock aborts in-flight uploads on unmount instead of silently losing them.
