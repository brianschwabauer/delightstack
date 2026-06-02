# Component conventions

## Hover transitions: instant in, slow out

**Rule:** When a `:hover` (or `:focus-visible` that shares the same visual change) alters a
**color-type property**, that change must apply with **no "in" transition** (duration `0`, or
extremely fast). The transition _back_ to the resting state (the "out") should be slower
(~120–300ms). In short: **snap in on hover, ease out on leave.**

"Color-type properties" means anything that recolors/tints a surface without moving or resizing it:
`color`, `background` / `background-color`, `border-color`, `box-shadow`, `outline`, `fill`,
and `opacity` when it is used as a tint (not as a reveal — see exceptions).

### Why

Snapping the color in makes the control feel **instantly responsive** — the moment the pointer
arrives, it reacts. Easing the color back out as the pointer leaves leaves a brief "trail" so the
user can see where they just were. Sweeping across a list of items (rows, options, buttons) then
feels alive: each item lights up instantly and fades behind you. A symmetric transition (slow in
_and_ out) feels laggy and mushy by comparison — the control appears to hesitate before
acknowledging the hover.

### How (the canonical technique)

A CSS transition is governed by the **destination** state's `transition` declaration. So:

- The transition **out** (hover → rest) is governed by the **base selector's** `transition`.
- The transition **in** (rest → hover) is governed by the **`:hover` rule's** `transition`.

Put the slow durations on the base selector, then **override `transition` inside `:hover` to
exclude the color properties** so they snap in. The base rule still eases them out on leave.

```css
.thing {
	/* governs the OUT transition — slow */
	transition:
		background-color 300ms,
		color 300ms,
		translate 200ms ease;
}
.thing:hover {
	background-color: var(--hover-bg);
	color: var(--hover-text);
	/* governs the IN transition — omit the colors so they snap in instantly.
	   Keep transform/size here so those still animate in (see exceptions). */
	transition: translate 200ms ease;
}
```

Shortcuts:

- If the hover changes _only_ color and there is no transform/size to preserve, use
  `transition: none;` inside `:hover`. The base rule's durations still ease the colors out.
- If the base selector has **no** `transition` at all, the color already snaps in (and out)
  instantly. That satisfies the rule — leave it. Adding a slow-out is a nice-to-have, not required.

The canonical reference implementation is `actions/Button.svelte` (`.button button`/`a` →
`&:hover`). `navigation/Tabs.svelte`, `navigation/Pagination.svelte`, `display/Calendar.svelte`,
and `display/Tree.svelte` follow the same pattern.

### Exceptions — keep the transition in both directions

- **Scale / transform / size changes** (`transform: scale(...)`, `translate`, growing
  `width`/`height`, etc.) should keep their transition on the way **in**. Scaling or moving in
  instantly is jarring; easing it looks deliberate and physical. Don't strip these.
- **Reveals** — a control fading itself in via `opacity` (a hidden close/clear button appearing on
  hover, an action bar sliding in) is a reveal, not a tint. A symmetric fade is the intended,
  graceful behavior. Leave it.
- **Slow color-in is OK when paired with an immediate supplemental effect.** If hovering produces
  instant feedback through some other channel, a slower secondary animation is fine — and often
  desirable. Example: `media/Gallery.svelte` "list" mode snaps the row background in instantly
  (`transition: opacity 0ms` on the tint layer) while the thumbnail _slowly scales up_
  (~350ms). Instant acknowledgement + dynamic motion. That combination is intentional; don't
  flatten the scale.

When in doubt: **colors snap in; shapes/sizes ease in; both ease out.**
