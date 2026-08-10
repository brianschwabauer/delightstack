---
'@delightstack/database': patch
---

Fix DO cold starts rebuilding every search index and bumping its config_version, which forced every client into a permanent wipe-and-full-resync loop. The persisted orama config (JSON, function members dropped) was deep-compared against the live config (which always carries `components.getDocumentIndexId`), so the check failed on every wake. Both the index-config check and the sql_indexes definition check now compare against the serializable projection.
