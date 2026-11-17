---
'@delightstack/components': patch
---

Alert moves focus to its Cancel button when it opens, so keyboard focus is never left on the trigger behind the dialog; focus still returns to the trigger when it closes. Modal gains an `initial_focus` prop (an element, a selector, or a function returning one) for where focus goes on open; the default is unchanged.
