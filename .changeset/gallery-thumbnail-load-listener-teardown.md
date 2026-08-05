---
'@delightstack/components': patch
---

Gallery: stop thumbnail load handlers from firing after their tile is destroyed.

The grid thumbnail `<img>`/`<video>` cleared their fade-in state from `onload`/`onloadeddata`/`onerror` attributes, which read the per-item `{@const key}` derived. A thumbnail still in flight when its tile unmounts (navigating away from a page, an item leaving the list) fires that media event on the now-detached element, so the handler ran after the item's derived was destroyed — logging `derived_inert` ("Reading a derived belonging to a now-destroyed effect") and writing state outside of Svelte's batch, which could in turn trip `invariant_violation: Batch has scheduled roots`.

The listeners now live in an attachment that captures the key as a plain string and removes them on teardown, so nothing runs after the tile is gone. Teardown also drops the key from the fading set, so an item that leaves and later returns can't get stuck at zero opacity.
