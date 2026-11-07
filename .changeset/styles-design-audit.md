---
'@delightstack/styles': minor
---

Design audit of the token layer.

- **Contrast:** status fills (`--color-error`, `--color-success`) and the dark-mode action color now pass WCAG AA with their text in both schemes, and form controls get a new `--color-border-control` that meets the 3:1 boundary rule (the decorative `--color-border` doesn't). Success shifts slightly toward blue-green.
- **Accent is an ink color:** near-black in light mode, near-white in dark, instead of a muted brand tint that read as disabled.
- **Warning** gains `-disabled`, `-active` and `-text*` tokens so it works as a button color.
- **Shadows are light-mode only.** In dark mode every `--shadow-*` layer is transparent; raised surfaces separate from the page with a 1px outline instead.
- **Type and motion:** small text sizes nudged up, `--space-2-5` (12px) added, `--ease-default`/`--ease-out` are now quart-out, and `--ease-out-strong` (quint-out) and `--ease-settle` are new.
