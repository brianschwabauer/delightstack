---
'@delightstack/components': patch
'@delightstack/styles': patch
---

Selected Button and focused field contrast:

- Selected (`active`) outline and transparent Buttons get their own, deeper wash instead of sharing the hover tint. They no longer look merely hovered in a ButtonGroup, and they stay visible with a dark brand color in dark mode. Hovering a selected button no longer fades it back to the hover tint.
- Icon-only end buttons in an attached ButtonGroup split their extra width across both sides (slightly more on the rounded end), so the icon sits centered in its segment instead of being pushed toward the group's middle.
- Input and Select draw their focus border and floated label in `--color-action-fg` instead of `--color-action`, so focusing a field brightens it in dark mode rather than dimming it.
