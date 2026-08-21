---
'@delightstack/components': minor
---

`Tree`: a bindable `focused` prop, type-ahead, and keys typed into a control are left alone

- `bind:focused` exposes the node the keyboard cursor is on. Focus and selection are
  separate in a tree — the arrows move the cursor and `Enter` selects — so an action
  outside the tree ("new sibling of the current node", rename, context menu) had no way
  to name the node the user is actually on.
- Typing printable characters jumps to the next node whose label starts with them,
  which is the one list behaviour every native tree has and this one did not. The
  buffer resets after 700ms and repeating a single character cycles the matches.
- Keystrokes and clicks that originate inside an `<input>`, `<textarea>`, `<select>`
  or a `contenteditable` element are no longer claimed by the tree, so a control
  rendered by the `node_content` snippet keeps its own arrows, `Home`/`End` and
  `Enter`. An inline rename field was previously unusable.
