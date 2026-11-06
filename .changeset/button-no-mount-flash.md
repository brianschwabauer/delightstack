---
'@delightstack/components': patch
---

Buttons no longer flash disabled when they appear after the page has hydrated.

A Button rendered `disabled` until its own effect ran, so a click couldn't land on server HTML
before its handler was attached. That guard also applied to Buttons created later, on a
client-side navigation for example. If the browser computed styles before the effect ran, the
button faded out of its disabled colours over the 300ms background transition, which looked like
a flash on every page switch. The guard now only applies while the page is first hydrating.
