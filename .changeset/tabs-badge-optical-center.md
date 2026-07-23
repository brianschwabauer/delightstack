---
"@delightstack/components": patch
---

Tabs: vertically center the tab badge count. The badge flex-centers its content's line box, but a digit's ink sits low inside a `line-height: 1` box (the font's ascent+descent overflow it asymmetrically), so the number read a hair low. The count is now wrapped in an inner element trimmed with `text-box-trim: trim-both; text-box-edge: cap alphabetic`, so the box hugs the glyph and the flex centering lands on the ink itself. Progressive enhancement — browsers without `text-box` support keep the previous rendering.
