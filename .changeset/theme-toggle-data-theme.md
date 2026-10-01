---
'@delightstack/components': minor
---

`ThemeToggle` now applies the theme through `data-theme` on `<html>` instead of an inline `color-scheme`, so it works in production builds.

Vite's default CSS minifier, Lightning CSS, lowers every `light-dark()` in `@delightstack/styles` to `var(--lightningcss-light, …) var(--lightningcss-dark, …)`. Only the stylesheet's own `color-scheme` rules set those variables (the `html` rule, the `prefers-color-scheme: dark` query and the `[data-theme]` rules), so the inline style the toggle wrote did nothing. In a production build the page followed the OS and the toggle only swapped its icon. Dev builds don't lower `light-dark()`, which is why the bug only showed in production.

The toggle now sets `data-theme="light"` or `data-theme="dark"` for an explicit choice and removes the attribute for auto, the mechanism the styles README documents.

**New prop `apply_theme`** (default `true`). Set it to `false` for a display-only toggle, such as a demo or preview: it still cycles, stores the choice and updates its own icon and label, but never touches `<html>`. The docs site's ThemeToggle demos use it, since a second toggle that removes `data-theme` for auto would strip the attribute Starlight's chrome depends on.

**Migration:** if you copied the old anti-flash `<head>` script from the docs, change its `style.colorScheme` write to `document.documentElement.dataset.theme = saved` for a saved `light` or `dark` (the ThemeToggle docs have the new script). A leftover inline `color-scheme` overrides `data-theme` in dev and puts native controls on the wrong scheme in production. A page that keeps its own resolved `data-theme` on `<html>` (Starlight does) will see the toggle remove it when the choice is auto, so give every toggle other than the one in charge `apply_theme={false}`.
