---
'@delightstack/components': patch
---

QR codes scan again. The light separator around each finder pattern was not reserved, so data bits were written into it and no reader could locate the code; the second copy of the format bits also overwrote the dark module and skipped one of its own cells.

`rounded` QR codes scan too: the finder and alignment patterns are now drawn as solid rounded shapes instead of separate dots, in the SVG and in the PNG download.
