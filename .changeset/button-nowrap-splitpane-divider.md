---
"@delightstack/components": patch
---

Button labels no longer wrap onto multiple lines when a flex container squeezes the button (`white-space: nowrap` on the base style). SplitPane pane bases now account for the divider's fixed 4px cross size — previously the two panes summed to a full 100% with grow/shrink locked to 0, pushing the second pane past the container's `overflow: hidden` edge and clipping ~4px of its content (e.g. right-aligned buttons losing their rounded corner); collapsed states reserve the divider space too.
