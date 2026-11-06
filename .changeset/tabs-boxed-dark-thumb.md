---
'@delightstack/components': patch
---

`Tabs` `boxed`: the active thumb shows in dark mode. It used `--color-surface`, which in dark mode is the
track's own color, so the selection all but vanished. In dark mode the thumb is now a neutral one step
lighter than the track, with no shadow (a shadow doesn't read on dark); light mode is unchanged.
