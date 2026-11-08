---
'@delightstack/components': major
'@delightstack/editor': patch
---

`Code` leaves the barrels — DS-13's per-component path, `Corkboard`'s stance applied
retroactively.

- **New exports:** `@delightstack/components/display/Code.svelte` and
  `@delightstack/components/display/code-tokens` join the `exports` map.
- **Removed from the `./display` (and therefore root) barrel:** `Code` and the *value*
  re-export of `tokenizeLine` (the `CodeToken` type re-export stays — types emit nothing).
  The tokenizer's top-level tables defeat Rollup's purity analysis, so a barrel edge to it
  puts ~3KB gzipped into whatever chunk eagerly imports `./display`, whether or not anything
  on that chunk draws code — measured in DelightWrite at +3.6KB of boot the moment its file
  previews (two dynamic imports off the boot path) named `Code` through a barrel, and +4.5KB
  through the file's own graph before the barrel edges were cut.
- **`./media/Video.svelte` gains a `types` entry** (DS-19's shape: a file export with no
  `types` fails `svelte-check` at the consumer; DelightWrite's video preview hit it).
- **Migration:** `import Code from '@delightstack/components/display/Code.svelte'` and
  `import { tokenizeLine } from '@delightstack/components/display/code-tokens'`. The editor's
  `CodeBlock` and code-highlight plugin, the docs demos and the example app are updated.

Breaking for anyone importing `Code`/`tokenizeLine` from a barrel, hence the major.
