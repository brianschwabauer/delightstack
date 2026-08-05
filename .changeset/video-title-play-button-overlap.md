---
'@delightstack/components': patch
---

Video: keep the big play button clear of the title chrome on short players. When a `title` is set, the resting controls (title + control bar) own the bottom ~78px of a paused player — on a short player the centred 76px play button sank into that band. The button now lives in its own height-queryable layer: at ≤260px tall it recentres in the picture area above the chrome and steps down to 56px, and at ≤180px it steps down again to 44px. Players without a title, and tall players with one, are unchanged.
