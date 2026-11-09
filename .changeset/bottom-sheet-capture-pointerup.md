---
'@delightstack/components': patch
---

BottomSheet: a press on a Popover trigger inside the sheet (a menu button) no longer leaves the sheet stuck mid-gesture. The trigger stops its `pointerup`, so the sheet never heard the press end: it followed the next mouse move and ignored every later drag. The sheet now listens in the capture phase, and a mouse moving with no button down ends a press it missed.
