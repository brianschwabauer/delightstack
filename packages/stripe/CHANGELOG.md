# @delightstack/stripe

## 1.1.5

### Patch Changes

- Updated dependencies [3112675]
  - @delightstack/utilities@1.3.0

## 1.1.4

### Patch Changes

- 8d69525: Every relative import in the built `dist/` is now a complete ESM specifier.

  The source files imported their siblings the way a bundler lets you — `from './error.helper'`,
  `from './helpers'`, `from './auth.client.svelte'` — and `svelte-package` copies specifiers
  through untouched, so the published `dist/` inherited them. Vite, esbuild and Rollup resolve
  those by probing for extensions and `index` files; Node's ESM loader does not. So the packages
  worked in every bundled context and failed the moment plain Node imported them — a SvelteKit
  SSR render step, a Vitest file that had not inlined the dependency, a one-off script — with
  `Cannot find module`.

  Relative specifiers now carry `.js` (a `.svelte.ts` rune module is `./x.svelte.js`), and
  directory imports name their `index.js`. `scripts/check-dist-specifiers.mjs`, wired into the
  root `build` and `test`, walks every `packages/*/dist/**/*.js` and fails the build on an
  incomplete relative specifier, so this cannot come back. No public API changed.

- Updated dependencies [8d69525]
  - @delightstack/utilities@1.2.2

## 1.1.3

### Patch Changes

- Updated dependencies [2721e99]
  - @delightstack/utilities@1.2.1

## 1.1.2

### Patch Changes

- Updated dependencies [a3e0a38]
  - @delightstack/utilities@1.2.0

## 1.1.1

### Patch Changes

- Updated dependencies [d86752e]
  - @delightstack/utilities@1.1.0

## 1.1.0

### Minor Changes

- b63d04e: Harden billing against Stripe's at-least-once delivery and eventual consistency. `customers.create` now sends a stable per-org/user idempotency key, so concurrent first requests (double-submits, parallel routes) and the ~1-minute lag in Stripe's customer search can no longer create duplicate customers — Stripe returns the same customer to every create. All webhook hooks now receive `event_id` (the Stripe event id) so apps can key grant-shaped side effects idempotently; `onOneTimePurchase`/`onPaymentSuccess`/`onPaymentFailed` docs now call this out explicitly. For cross-isolate webhook deduplication, a minimal `StripeEventStore` Durable Object is available from `@delightstack/stripe/worker` with a `durableObjectEventStore(binding)` adapter for `webhook_event_store` — optional, nothing new to deploy unless you opt in. When grant-shaped hooks run against the default in-memory (per-isolate) store, a one-time warning now explains the double-fire risk instead of staying silent.

### Patch Changes

- 0c92f48: Type-level fixes so consumer apps typecheck cleanly: the database schema's `Table` constraint no longer degenerates into an impossible `table_definition` union when a field generator's shape is `any`, and `StringFieldInputType` now matches the runtime (`tel` / `datetime-local` instead of `phone` / `datetime`); stripe's `PlanDefinition.entitlements` accepts `readonly string[]`; the images and ai request handles and utilities' `createDevHandle` are now generic over the event so they compose with SvelteKit's `Handle` without casts; the editor package no longer emits an `Editor` component export shadowed by the `Editor` class type (which made the component import type-only for consumers).
- Updated dependencies [0c92f48]
  - @delightstack/utilities@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/utilities@1.0.0

## 0.2.0

### Minor Changes

- **One-time plans.** A plan may now omit `interval` to become a one-time purchase: product sync creates non-recurring prices, `POST /checkout` uses `mode: 'payment'` (with invoice creation) and stamps `plan_id` metadata on every session, and the webhook resolves that metadata on `checkout.session.completed` to fire a new `onOneTimePurchase` hook — the app decides what a purchase grants (a credit, a timed pass, a permanent entitlement). Recurring plans are unchanged; `PlanInfo.interval` is now optional.
