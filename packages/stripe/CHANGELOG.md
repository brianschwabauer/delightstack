# @delightstack/stripe

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/utilities@1.0.0

## 0.2.0

### Minor Changes

- **One-time plans.** A plan may now omit `interval` to become a one-time purchase: product sync creates non-recurring prices, `POST /checkout` uses `mode: 'payment'` (with invoice creation) and stamps `plan_id` metadata on every session, and the webhook resolves that metadata on `checkout.session.completed` to fire a new `onOneTimePurchase` hook — the app decides what a purchase grants (a credit, a timed pass, a permanent entitlement). Recurring plans are unchanged; `PlanInfo.interval` is now optional.
