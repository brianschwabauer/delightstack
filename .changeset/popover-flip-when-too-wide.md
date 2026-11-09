---
'@delightstack/components': patch
---

Popover flips to the other side of its target when it doesn't fit on its own side, even when it is wider than the room beside the target. The browser's `position-try-fallbacks` only flips into a spot that fits on both axes, so a wide popover near the bottom of a narrow pane used to hang off the screen.
