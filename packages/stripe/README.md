# @delightstack/stripe

Stripe billing for Cloudflare Workers and SvelteKit — products, metered usage, webhooks, and
subscription guards. Part of the [Delightstack](https://thedelight.co).

## Install

```bash
pnpm add @delightstack/stripe stripe
```

## Entry points

| Import | Use |
| --- | --- |
| `@delightstack/stripe/server` | Worker-side billing: products, metered usage, webhook handling |
| `@delightstack/stripe/client` | Reactive Svelte 5 billing client |
| `@delightstack/stripe/sveltekit` | SvelteKit subscription guards |
| `@delightstack/stripe/types` | Shared types |

`svelte` and `@sveltejs/kit` are optional peer dependencies, required only when you use the
`client` / `sveltekit` entry points respectively.

## Plan bits

A subscription sync writes the org's `plan` integer through the auth RPC. The package owns only
the bits of entitlements some configured plan grants (each plan's `entitlements`, at their index
in `config.entitlements`). It reads the org with `getOrg`, sets or clears those bits, and leaves
every other bit as it was, so app-owned flags in `plan` survive. Nothing is written when the value
would not change. Pass an auth RPC with `getOrg` (the `@delightstack/auth` server has it); without
one the sync replaces the whole integer.

## `onSubscriptionChange`

The hook runs every time the package re-syncs a customer: the `customer.subscription.*` and
subscription-mode `checkout.session.completed` webhooks, and the `POST /subscription`,
`DELETE /subscription` and `POST /sync` routes. When the customer has no active, trialing,
past_due or canceled subscription but has another one (`incomplete`, `unpaid`, `paused`, ...), the
hook gets that subscription's real status with `plan_id: null` and no entitlements. It does not
run for a customer with no subscription at all.

## Fake Stripe server

Set `stripe_api_url` to send every API call to another server, for tests and local development:

```ts
defineBillingConfig({
	secret_key: env.STRIPE_SECRET_KEY,
	publishable_key: env.STRIPE_PUBLISHABLE_KEY,
	stripe_api_url: dev ? env.STRIPE_API_URL : undefined, // e.g. 'http://localhost:12111'
});
```

Its protocol, host and port go to the Stripe SDK; any path is ignored. The client always uses the
SDK's fetch HTTP client, so it runs on Cloudflare Workers.

## Documentation

Full docs: <https://docs.thedelight.co>

## License

MIT © Brian Schwabauer
