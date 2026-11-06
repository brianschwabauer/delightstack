---
'@delightstack/components': patch
---

`Checkbox`: a label with a long description stays beside its box in a narrow container. The text block was sized to its max-content inside a wrapping row, so once the description was wider than the space left it dropped onto its own line under the box; it now shrinks and wraps its text instead.
