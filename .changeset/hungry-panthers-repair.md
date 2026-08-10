---
'@delightstack/database': patch
---

Fix DO cold starts rebuilding every search index and bumping its config_version, which forced every client into a permanent wipe-and-full-resync loop. The persisted orama config (JSON, function members dropped) was deep-compared against the live config (which always carries `components.getDocumentIndexId`), so the check failed on every wake. Both the index-config check and the sql_indexes definition check now compare against the serializable projection.

Also normalize where-clause shorthands in both search paths: plain values and arrays on enum properties become `{eq}`/`{in}`, plain numbers become `{eq}` (Orama requires operation objects there and its throw surfaced as a 500), and Orama's filter-validation errors now return 400 instead of 500.
