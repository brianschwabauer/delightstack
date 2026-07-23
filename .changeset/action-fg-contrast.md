---
"@delightstack/styles": minor
"@delightstack/components": patch
---

Fix low-contrast action-colored text and icons (most visibly in dark mode) when the brand seed is dark. `--color-action` is a *surface* token — its lightness is clamped to a mid band (dark 0.4–0.6) so it reads as a fill under `--color-action-text`. Several components were using it directly as a **foreground** color on the neutral page/card background, which only stays legible when the seed happens to be light: the default `#10a6c4` seed squeaks past AA at ~4.9:1, but a dark seed lands at the clamp floor and drops to ~2:1 (failing WCAG AA).

New semantic tokens `--color-action-fg` / `--color-accent-fg` (styles) provide a lightness-lifted foreground — the same lift the outline `Button` already applies to its own text — so accent text/icons stay ≥4.5:1 regardless of how dark `--color-primary` is. Components now use them wherever action/accent is text or an icon on a neutral surface: `Tabs` (active label + underline indicator), `Callout` (icon/title/dismiss/accent-bar, via a derived `--callout-fg`), `Stat`, `Code`, `PDF`, `Table` (pending status), `Fieldset` (hover), `FileUpload` (browse link), and `Toast` (info/loading). Paired backgrounds, borders, and focus rings still use `--color-action` unchanged.
