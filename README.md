# Delightstack

**A full-stack toolkit for building delightful apps on Cloudflare.** Svelte 5 components,
edge-native auth, a reactive Durable-Object database, real-time websockets, image processing,
billing, and AI — designed to work together, usable on their own.

🌐 [thedelight.co](https://thedelight.co) · 📚 [docs.thedelight.co](https://docs.thedelight.co) ·
🧪 [example.thedelight.co](https://example.thedelight.co)

## Packages

| Package | What it does |
| --- | --- |
| [`@delightstack/components`](packages/components) | Svelte 5 component library — actions, forms, media, navigation, feedback, display |
| [`@delightstack/utilities`](packages/utilities) | Shared utilities + the `DelightError` error class |
| [`@delightstack/styles`](packages/styles) | OKLCH design tokens and base CSS |
| [`@delightstack/auth`](packages/auth) | JWT sessions, Argon2id, OAuth, SvelteKit guards (Durable Objects) |
| [`@delightstack/database`](packages/database) | Reactive SQLite over Durable Objects with full-text search |
| [`@delightstack/websocket`](packages/websocket) | Real-time presence & messaging (Durable Objects) |
| [`@delightstack/rate-limiter`](packages/rate-limiter) | Sliding-window rate limiting (Durable Objects) |
| [`@delightstack/images`](packages/images) | Image processing via Cloudflare Containers + Sharp |
| [`@delightstack/ai`](packages/ai) | Embeddings, AI Gateway, and a reactive streaming client |
| [`@delightstack/stripe`](packages/stripe) | Stripe billing, metered usage, webhooks |

The frontend packages (`components`, `utilities`, `styles`) are framework-agnostic-ish and work in
any Svelte 5 / Vite app. The backend packages target **Cloudflare Workers + Durable Objects**; the
[`example-app`](apps/example-app) is the canonical reference for wiring them together.

## Install

```bash
pnpm add @delightstack/components @delightstack/styles @delightstack/utilities
```

`@delightstack/components` reads all of its colors, typography, spacing, and motion from the CSS
custom properties shipped by `@delightstack/styles` — install it alongside the components and import
it once at the root of your app (`import '@delightstack/styles';`).

All packages are published as ESM and target `moduleResolution: "bundler"` (SvelteKit, Vite, and
Wrangler all use this). Svelte 5 is an optional peer dependency for packages with reactive clients.

## AI coding agents

DelightStack is agent-friendly: every docs page is plain markdown at `<page-url>.md`, the whole
site is indexed at [docs.thedelight.co/llms.txt](https://docs.thedelight.co/llms.txt), and the
component library ships a ready-made agent skill. Set up Claude Code / Cursor / Codex in one
command from your project root:

```bash
pnpm exec delightstack-agents
```

See the [AI Agents guide](https://docs.thedelight.co/guides/ai-agents/) for details.

## Error handling

Every package uses `DelightError` from `@delightstack/utilities` as the single operational error
class. Never throw plain objects, `new Error()`, or other custom error classes for operational errors.

```ts
import { DelightError } from '@delightstack/utilities';

throw DelightError.badRequest('Invalid input'); // 400
throw DelightError.notFound('Resource not found'); // 404

throw new DelightError({ message: 'Boom', status: 500, code: 'INTERNAL_ERROR' });

const err = DelightError.from(unknownError); // normalize unknowns
return err.toResponse(); // → Response
```

## Development

This is a [pnpm](https://pnpm.io) + [Turborepo](https://turborepo.com) monorepo.

```bash
pnpm install          # install everything
pnpm build            # build all packages (in dependency order)
pnpm dev              # marketing site + components + utilities in watch mode
pnpm dev:docs         # docs site
pnpm dev:example      # full example app (SvelteKit + Worker)
pnpm typecheck        # tsgo across the monorepo
```

## Releasing

Versions and changelogs are managed with [Changesets](https://github.com/changesets/changesets).

```bash
pnpm changeset        # describe a change (bumps the linked package group together)
```

On merge to `main`, the [release workflow](.github/workflows/release.yml) opens a "Version
Packages" PR; merging that PR publishes the packages to npm with provenance.

## License

MIT © Brian Schwabauer
