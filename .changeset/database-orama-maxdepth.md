---
"@delightstack/database": patch
---

Raise the msgpack `maxDepth` to 4096 when persisting the saved Orama index. Large or deeply-nested indexes could exceed the default depth limit and fail to encode; the higher ceiling lets consumers with bigger indexes persist them without hitting the depth cap.
