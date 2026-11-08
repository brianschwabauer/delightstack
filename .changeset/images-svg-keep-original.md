---
'@delightstack/images': patch
---

Fix `keep_original: false` deleting an SVG's only variant. The SVG pipeline emits its sanitized output as a variant named `original` (SVGs get no resized variants), and the post-processing cleanup deleted the R2 key of the raw upload — the same key — leaving the record's variant list pointing at nothing. The cleanup now skips the delete when an output variant claimed the `original` name.
