---
'@delightstack/utilities': patch
'@delightstack/components': patch
'@delightstack/editor': minor
---

focusTrap activates even when its container has no tabbable node yet: the trap falls back to the container itself, so the Gallery lightbox (and Modal, Popover, CommandPalette) now trap focus, close on Escape and return focus to the trigger. Activation failures are reported instead of swallowed. Gallery lightbox takes initial focus.

renderHTML gives headings an `id` from their text (`heading_ids` option, default on) and exports `slugifyHeading()` so consumers can build matching anchors.
