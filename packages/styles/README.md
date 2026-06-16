# @delightstack/styles

Global CSS for the [Delightstack](https://thedelight.co) — OKLCH design tokens, generated color
scales, and base styles that the `@delightstack/components` library is built against.

## Install

```bash
pnpm add @delightstack/styles
```

## Usage

Import the stylesheet once, at the root of your app:

```ts
import '@delightstack/styles';
// or explicitly:
import '@delightstack/styles/global.css';
```

This defines the `--color-*` token scales (derived from `--color-primary` via `oklch(from …)`),
light/dark `color-scheme`, and base element styles.

Need the tokens but not the base element styles (e.g. you're dropping them into an existing design
system)? Import the pieces directly:

```ts
import '@delightstack/styles/tokens.css'; // design tokens only
import '@delightstack/styles/scrollbar.css'; // styled-native scrollbar baseline
```

## Cascade layers

`global.css` puts everything it sets on real elements — the reset and the base element styles —
inside `@layer delight.reset`, `@layer delight.base`, and `@layer delight.utilities`. Unlayered
rules always beat layered ones, so **your own styles win without specificity battles or
`!important`** — just write normal CSS:

```css
/* No fight with the base styles — your rule is unlayered, so it wins. */
a {
	color: rebeccapurple;
}
```

Want all of Delightstack to sit below your own layered styles? Order the parent layer once:

```css
@layer delight, app;
/* ...your styles in `app` now outrank everything Delightstack ships. */
```

Two things are deliberately left **unlayered** so they stay hard to override: the
`prefers-reduced-motion` reset and the `!important` `.mobile-only` / `.mobile-hidden` utilities.

The design **tokens** (`tokens.css`) are plain custom properties on `html`, also unlayered —
override any of them with normal specificity (see below).

## Theming

Every token is derived from a single brand seed. Override it (and, optionally, the neutral/secondary
seeds) on `:root` to recolor the whole system:

```css
:root {
	--color-primary: #7c3aed; /* the whole ramp, charts, actions… all follow */
}
```

## Light & dark mode

Theming tokens are `light-dark()` values, so the active scheme is driven by the `color-scheme`
property — there is no `.dark` class. By default the tokens follow the OS preference. To force a
scheme, set `data-theme` on `<html>` (or on any subtree — `color-scheme` inherits, so you can theme
just one section):

```html
<html data-theme="dark">
  <!-- forced dark, regardless of OS -->
</html>
```

Toggle it from JS for a manual switch:

```ts
document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
// remove it to fall back to the OS preference:
delete document.documentElement.dataset.theme;
```

## Documentation

Full docs: <https://docs.thedelight.co>

## License

MIT © Brian Schwabauer
