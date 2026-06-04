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

This defines the `--color-*` token scales (derived from `--color-dashboard` / `--color-primary`
via `oklch(from …)`), light/dark `color-scheme`, and base element styles.

## Documentation

Full docs: <https://docs.thedelight.co>

## License

MIT © Brian Schwabauer
