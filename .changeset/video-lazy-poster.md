---
'@delightstack/components': minor
---

Video: lazy poster loading via a new `lazy` prop (default `true`).

A bare `poster` attribute is fetched by the browser's preload scanner the moment the HTML is parsed — every below-fold player's poster joins the initial page load (on a page with a dozen inline players that's easily 1–2MB of screens-away JPEGs competing with the critical path). The poster attribute is now withheld until the player nears the viewport, riding the same one-shot ~150%-margin intersection observer the HLS attach gate already uses; play intent and `autoplay` also reveal it immediately, and platforms without IntersectionObserver fail open. Server-rendered HTML omits the poster while `lazy` is on, which is what keeps it out of the preload scanner. Set `lazy={false}` for above-the-fold players whose poster must paint with the first render (this restores the old behavior, poster present in SSR HTML included) — mirrors `Image`'s `lazy` prop, which also defaults to `true`.
