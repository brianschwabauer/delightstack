---
'@delightstack/components': patch
---

Popover: no more sideways jump as an arrowed popover finishes opening. The arrow shift (which keeps the arrow clear of the rounded corners) was measured from the panel's box while the open animation was still scaling it, then re-measured at full size; it now measures the laid-out box with the running transform taken out, so both agree.
