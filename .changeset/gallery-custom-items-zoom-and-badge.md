---
'@delightstack/components': minor
---

Gallery/Carousel: `custom` items are now first-class media. They get the same pinch-zoom / double-tap-zoom / wheel-zoom mechanics as images — the zoom matrix was already applied to the slide's content element generically, but `isScalable()` hard-excluded `custom`, which also made the documented `disable_zoom` escape hatch a no-op for the one type it was written for. A custom item that handles its own zoom still opts out with `disable_zoom`. Gallery grid/list thumbnails also no longer render an empty type-badge disc over `custom` items: the badge only appears for types that actually have an icon (video, pdf, embed, panorama).
