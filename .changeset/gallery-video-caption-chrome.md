---
"@delightstack/components": patch
---

Gallery's fullscreen caption no longer sits on top of a video's player controls. On a video slide the caption is no longer an overlay at all — Gallery hands it to the player, which draws it as part of its own chrome: directly above the control bar, under the same scrim, so one gradient carries caption and controls together instead of two scrims meeting in a visible seam. It appears and fades with the controls, so it's gone once playback runs and the pointer goes idle, and back on pointer move or pause. Image and PDF slides keep the bottom-pinned caption they had.

Video gained a `title` prop for this (a short caption shown with the controls, distinct from the `captions` subtitle tracks), and Carousel a `caption_display` prop that forwards an item's caption to the player.
