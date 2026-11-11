---
'@delightstack/auth': patch
---

Signing out no longer fails with "Expected exactly one result from SQL query" when the session row is already gone (revoked from another device, or by a password change, while the browser's JWT is still valid). `revokeSession` is now idempotent.
