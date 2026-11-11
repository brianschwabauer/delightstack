---
'@delightstack/components': patch
---

The package now declares `"sideEffects": ["**/*.css"]`, so bundlers can drop the components an app doesn't use. Without it, importing anything from `@delightstack/components` kept every module the barrel re-exports. In one SvelteKit app, every page, sign-in included, loaded a 353 KB chunk (105 KB gzip) holding about 45 components, plus their 302 KB of CSS. Components that app never renders (QR, Timeline, Confetti, Pagination and others) shipped anyway. Nothing to change in your code; components you use are bundled as before.
