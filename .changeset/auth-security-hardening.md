---
'@delightstack/auth': minor
---

Security hardening for org invitations, membership tokens, and token sources:

- **Invitation routes now require org admin.** `POST /invitation` previously only required membership, so any member could mint an invitation with any permission bits (including admin) and escalate through a second account. `PATCH`/`DELETE /invitation/:id` additionally verify the invitation belongs to the caller's active org — they were unscoped primary-key operations, allowing cross-org escalation and deletion.
- **`requireOrgAdmin` recognizes owners without a membership token.** Ownership is checked before membership, so an org owner passes admin checks even when their session token carries no permission bits for the org (e.g. immediately after `createOrg` with a misconfigured `org_admin_permission`).
- **The only-admin removal guard uses the configured `orgAdminPermission`.** It previously matched the hardcoded name `'org:write'`, which silently disabled the "cannot remove the only admin" protection for every app with its own permission set.
- **Permission-0 rows are excluded from session tokens and org resolution.** `createSessionToken` no longer encodes `org_user` rows with no permission bits, and `defaultResolveOrgId` ignores such tokens — a lingering zero-permission row can no longer resolve an org or pass membership checks.
- **The `?auth=` query-parameter JWT source is now opt-in** via the new `allow_query_token` config flag (default `false`). URLs leak into Referer headers, browser history, and server logs, so a query-string token source must be a deliberate choice.

Migration notes: apps that let non-admin members create invitations must now grant those members the admin permission or create invitations server-side. Apps relying on `?auth=` must set `allow_query_token: true`. Ensure `org_admin_permission` (handler config) and `orgAdminPermission` (Durable Object options) name a real entry in your `permissions` array — with the old default `'org:admin'` unmatched, org creators started with zero permission bits and only owners passed admin checks.
