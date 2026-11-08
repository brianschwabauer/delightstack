---
'@delightstack/ai': patch
'@delightstack/auth': patch
'@delightstack/components': patch
'@delightstack/database': patch
'@delightstack/images': patch
'@delightstack/mcp': patch
'@delightstack/presence': patch
'@delightstack/rate-limiter': patch
'@delightstack/stripe': patch
'@delightstack/utilities': patch
'@delightstack/websocket': patch
---

Every relative import in the built `dist/` is now a complete ESM specifier.

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
