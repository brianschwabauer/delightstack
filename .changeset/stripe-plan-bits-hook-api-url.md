---
'@delightstack/stripe': minor
---

Subscription syncs no longer wipe plan bits the package does not own. The package owns only the bits of entitlements some configured plan grants; a sync reads the org (`getOrg`, now typed to return `plan`), sets or clears those bits, leaves every other bit alone, and skips the write when nothing changes. Without `getOrg` on the auth RPC it still replaces the whole integer.

`onSubscriptionChange` now runs on every re-sync: `POST /sync`, `POST /subscription` and `DELETE /subscription` always, subscription-mode `checkout.session.completed`, and subscription webhooks whose customer has only an `incomplete`, `unpaid` or `paused` subscription (reported with its real status, `plan_id: null` and no entitlements). A customer with no subscription at all is still not reported.

New optional `stripe_api_url` config points the Stripe client at a fake server for tests and local development. The client now always uses the SDK's fetch HTTP client, so it works on Cloudflare Workers.
