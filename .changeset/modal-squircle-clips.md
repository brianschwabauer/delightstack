---
'@delightstack/components': patch
---

Modal opens without rastering squircle masks on every frame: the full-viewport `.modal` box no longer clips (the panel never reaches its edges), and the scrolling body clips to a round radius at the doubled squircle size, which sits inside the squircle panel. Chrome built a full-size mask layer for every squircle clip and repainted it through the open animation. The panel surface and close button keep their squircle corners, and the mobile layout is unchanged.
