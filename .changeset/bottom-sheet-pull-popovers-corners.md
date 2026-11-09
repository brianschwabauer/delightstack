---
'@delightstack/components': patch
---

BottomSheet: pulling down from the top of a fully open sheet's content now drags the sheet with the finger (the browser used to take the gesture as a scroll, cancel it, and the sheet read the cancel as a flick and jumped to its next snap down). A cancelled gesture, or a finger that comes to rest before lifting, now settles on the nearest snap instead of counting as a flick. The sheet portals into `.portals` rather than straight into `<body>`, so a Popover opened from inside it anchors to its trigger instead of falling to the bottom of the page. The panel clips its content to its rounded corners.
