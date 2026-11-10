---
'@delightstack/styles': patch
---

Reduced motion: transitions are now 0s instead of 0.01ms. Every element defaults to `transition-property: all`, so the 0.01ms duration turned each style change on each element into a one-frame transition, and a layout read straight after a change (a `getBoundingClientRect()`, a scroll anchored to a new size) saw the old value. `transitionend` no longer fires with reduced motion on; code waiting for it needs a timeout fallback, as Table and the ripple already have.
