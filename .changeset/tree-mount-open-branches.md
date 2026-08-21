---
'@delightstack/components': patch
---

`Tree`: collapsed branches are no longer rendered

- The tree mounted every descendant it was given, expanded or not. A 10,000-node
  tree with two rows on screen put 10,520 `<li>` and 54,680 elements in the
  document, and every keystroke then paid for all of them: one arrow press cost
  ~28ms of main thread where the same press on the same tree now costs ~2ms.
  Collapsed branches are mounted when they open and unmounted once the closing
  animation has run, so DOM size follows what is open rather than how much data
  was handed in — the same fixture is now 20 `<li>` and 140 elements.
- The expand animation grows `grid-template-rows: 0fr → 1fr`, which needs the
  rows to exist and their collapsed state to be committed before the open state
  is applied. Opening therefore takes two steps a style pass apart rather than
  one, and reduced motion skips straight to the open state as it did before.
- Nothing changes for a consumer who was not hitting this: props, events and
  bindings are untouched, and a tree small enough to mount whole renders the same
  DOM once it is open. Code that reaches into the tree with `querySelector` will
  only find rows inside open branches.
