---
'@delightstack/components': minor
---

Gallery: animated video posters and a controllable outside gap.

- **`poster_video` item field.** When set, grid/masonry/list thumbnails render a muted looping `<video>` instead of the poster `<img>`. This gives animated-image content (GIF/animated AVIF) with a video twin a hardware-decoded path in gallery tiles — animated images are decoded in software frame by frame, while an equivalent AV1/H.264 mp4 rides the hardware decoder. The tile video loads nothing until it nears the viewport (`preload="none"` plus an intersection observer), plays only while near, pauses when scrolled away, and under `prefers-reduced-motion` never plays (only a still first frame is fetched). `poster` (when also set) is used as the `<video poster>` while it loads, and the thumbhash blur/fade-in behaves exactly as it does for image tiles.
- **`outside_gap` prop** (`boolean | undefined`, default `undefined` = "auto") controls the padding around the grid/masonry/masonry-row layouts that matches the interior gap. `true` always pads (the old behavior), `false` never pads, and auto keeps the gap only when the gallery is full-bleed — inside a narrower container the padding read as the gallery failing to fill its container, so auto drops it there. Auto is resolved in pure CSS (a clamp step function comparing the containing block against `100vw`, with 32px of slack for a classic desktop scrollbar), so it tracks resizes with no script.
