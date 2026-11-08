---
'@delightstack/images': patch
---

`date_taken` is now guaranteed canonical UTC ISO 8601, or null — never a passthrough of the EXIF spelling. `DateTimeOriginal` is a zoneless wall clock; when `OffsetTimeOriginal` names its real zone (`±HH:MM` per EXIF 2.31, or `Z`), the stored instant is corrected by it, and an unreadable or impossible offset is treated as absent rather than guessed at. Consumers compare the stored string lexicographically against UTC boundaries, so an unnormalized value silently misordered and misfiltered. Existing deployments: already-processed records keep the value the old extraction wrote (the wall clock stamped as UTC, offset ignored) — reprocess if offset-correct capture times matter to you.
