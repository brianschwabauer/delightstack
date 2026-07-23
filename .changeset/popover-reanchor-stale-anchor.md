---
"@delightstack/components": patch
---

Fix `Popover` mispositioning after re-anchoring: when `ref_element` changed while the popover was open, the previous element kept its `anchor-name` (it was only cleared on outro-end). With several elements sharing the popover's anchor name, CSS anchor positioning resolves to the last one in DOM order, so the panel could attach to a stale element — while the JS-positioned arrow still pointed at the current one. The anchor-name is now released from the old element the moment the popover re-anchors; closing still keeps it through the outro.
