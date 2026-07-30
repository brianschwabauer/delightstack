---
'@delightstack/components': minor
---

Video: HLS sources now honor `preload`. Previously an HLS video attached its stream on mount — downloading the hls.js chunk, the manifest, and the first segments even with `preload="none"` and even far off-screen. Attachment is now gated: `preload="none"` defers all network activity until playback is actually requested (the play intent attaches the stream and starts playback in one click); `preload="metadata"`/`"auto"` attach once the player nears the viewport (IntersectionObserver, 150% margin, fail-open where IO is unavailable); `autoplay` still attaches immediately. Pre-play seeks on a deferred stream lift the gate so metadata can resolve, and changing `src` after attach still re-attaches as before.
