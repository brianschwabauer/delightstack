---
'@delightstack/components': patch
---

BottomSheet: pulling down from the top of a fully open sheet's content now drags the sheet with the finger (the browser used to take the gesture as a scroll, cancel it, and the sheet read the cancel as a flick and jumped to its next snap down). A press inside a scroller of its own within the content (a chat feed) counts as "at the top" only when that scroller is, so pulling down a scrolled feed scrolls it instead of dragging the sheet. A cancelled gesture, or a finger that comes to rest before lifting, now settles on the nearest snap instead of counting as a flick. The sheet portals into `.portals` rather than straight into `<body>`, so a Popover opened from inside it anchors to its trigger instead of falling to the bottom of the page. A sheet at rest follows its snap's height when that changes (its content grew or shrank, or the snap points moved) instead of staying at the old height. The panel clips its content to its rounded corners.
