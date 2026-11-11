---
'@delightstack/components': patch
---

`Table` loads its cell editor only when the table is `editable`. The editor is about a third of the component's code (21 KB of the 55 KB the two ship together), and a read-only table used to download it anyway. An editable table imports it as soon as it mounts, and until it arrives an active cell shows its value. In practice it has loaded long before anyone double-clicks a cell. Nothing to change in your code.
