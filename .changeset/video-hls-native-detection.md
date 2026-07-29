---
'@delightstack/components': patch
---

Fix `Video` silently failing to play HLS in Chrome 150+. The player decided whether to use the browser's own HLS support by asking `canPlayType('application/vnd.apple.mpegurl')` and treating any non-empty answer as yes. Chrome 150 changed its answer from `''` to `'maybe'` while remaining unable to play a playlist, so every Chrome user got the playlist handed straight to the media element, which stalls at `readyState 0` and never fires an `error` — no playback, no error state, just a poster that does nothing when pressed. This affected `Gallery` and `Carousel` video slides too, since they render `Video`.

Native playback now additionally requires the absence of Media Source Extensions, a combination that only holds on Apple's media stack. Everywhere MSE exists — including desktop Safari — hls.js drives the stream, which is the order hls.js's own docs prescribe. iPhones still take the native path and still never download hls.js. If hls.js declines the platform after loading, the element is tried as a last resort rather than going straight to an error.
