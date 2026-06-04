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

## Documentation

Full docs: <https://docs.thedelight.co>

## License

MIT © Brian Schwabauer
