---
'@delightstack/diff': patch
---

The package's internal imports carry their `.js` extension.

`dist/index.js` imported `'./diff.error'` and `'./diff.text'`, which are incomplete ESM
specifiers. A bundler resolves them, so the browser and a Worker build were fine and the defect
went unseen — but Node's ESM loader does not, so importing the package from a plain Node process
(a script, or a Vitest file that had not inlined it) threw `Cannot find module`. Nothing about
the API changed.
