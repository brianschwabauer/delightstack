---
'@delightstack/components': patch
---

`Tabs`: the selection shows on first paint. The sliding indicator is placed by measuring the active
tab, which can't happen until hydration, so a server-rendered `Tabs` showed no underline (or, `boxed`,
no thumb) and faded one in afterwards. Until the indicator is placed, the active tab now draws the same
mark itself in CSS; the indicator takes over in that same frame, with no fade, and glides as before.
