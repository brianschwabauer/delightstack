# @delightstack/presence

## 2.0.3

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
  - @delightstack/auth@1.4.1
  - @delightstack/utilities@1.2.2
  - @delightstack/websocket@2.2.1

## 2.0.2

### Patch Changes

- Updated dependencies [2721e99]
  - @delightstack/utilities@1.2.1
  - @delightstack/auth@1.2.2
  - @delightstack/websocket@2.1.9

## 2.0.1

### Patch Changes

- Updated dependencies [a3e0a38]
  - @delightstack/utilities@1.2.0
  - @delightstack/websocket@2.1.6
  - @delightstack/auth@1.2.1

## 2.0.0

### Patch Changes

- Updated dependencies [d86752e]
  - @delightstack/websocket@2.0.0
  - @delightstack/auth@1.2.0
  - @delightstack/utilities@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [2d631f4]
- Updated dependencies [1faece7]
- Updated dependencies [16f9b7f]
- Updated dependencies [0c92f48]
  - @delightstack/auth@1.0.1
  - @delightstack/websocket@1.0.2
  - @delightstack/utilities@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
- Updated dependencies [8420739]
  - @delightstack/auth@1.0.0
  - @delightstack/utilities@1.0.0
  - @delightstack/websocket@1.0.0
