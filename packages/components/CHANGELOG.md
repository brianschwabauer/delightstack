# @delightstack/components

## 2.0.2

### Patch Changes

- 48b822e: Transparent and translucent icon buttons now place their badge on the icon's top-right corner, at a size matched to the icon, with the cutout centred on the badge. Before, a number badge sat over most of a dense icon and its cutout was off-centre, so the glyph showed through around the badge.
- ed31c2d: Popover flips to the other side of its target when it doesn't fit on its own side, even when it is wider than the room beside the target. The browser's `position-try-fallbacks` only flips into a spot that fits on both axes, so a wide popover near the bottom of a narrow pane used to hang off the screen.

## 2.0.1

### Patch Changes

- fb1fb4b: ListItem's ripple now lives inside the row that the press scales, so the ripple and the highlight shrink together instead of showing two different boxes. Checkbox and Radio play their spring animation whenever their state changes, including when a parent sets it (List's checkbox and radio modes, "select all", a group value set from outside). Radio's reduced-motion rules now cover a standalone Radio too. tokens.css turns off the mobile tap-highlight box for the whole page.
- Updated dependencies [fb1fb4b]
  - @delightstack/styles@1.2.1

## 2.0.0

### Major Changes

- d49cb61: `Code` leaves the barrels — DS-13's per-component path, `Corkboard`'s stance applied
  retroactively.

  - **New exports:** `@delightstack/components/display/Code.svelte` and
    `@delightstack/components/display/code-tokens` join the `exports` map.
  - **Removed from the `./display` (and therefore root) barrel:** `Code` and the _value_
    re-export of `tokenizeLine` (the `CodeToken` type re-export stays — types emit nothing).
    The tokenizer's top-level tables defeat Rollup's purity analysis, so a barrel edge to it
    puts ~3KB gzipped into whatever chunk eagerly imports `./display`, whether or not anything
    on that chunk draws code — measured in DelightWrite at +3.6KB of boot the moment its file
    previews (two dynamic imports off the boot path) named `Code` through a barrel, and +4.5KB
    through the file's own graph before the barrel edges were cut.
  - **`./media/Video.svelte` gains a `types` entry** (DS-19's shape: a file export with no
    `types` fails `svelte-check` at the consumer; DelightWrite's video preview hit it).
  - **Migration:** `import Code from '@delightstack/components/display/Code.svelte'` and
    `import { tokenizeLine } from '@delightstack/components/display/code-tokens'`. The editor's
    `CodeBlock` and code-highlight plugin, the docs demos and the example app are updated.

  Breaking for anyone importing `Code`/`tokenizeLine` from a barrel, hence the major.

### Minor Changes

- 1e8efb2: Design audit across the component set.

  - **New:** `Button` `warning` color and `value` prop; `ButtonGroup` segmented mode (`bind:value`, optionally `translucent` for a neutral selected chip); `Table` `column_dividers` (row dividers only by default, softer than the frame); `Stat` `positive="down"` for metrics where lower is better.
  - **Fixes:** hover popovers no longer trap focus; chart lines reach their last point; the command palette highlights the row Enter will run; Rating's half stars lose their seam; DiffViewer aligns line numbers and spaces changed words; the menu-button chevron renders; trailing icons in `Input`/`Select` sit as far from the right edge as from the top and bottom; overlapping `AvatarGroup` skeletons no longer show through each other; `ContextMenu` renders once even when mounted several times.
  - **Toast:** the close button is a small bubble in a "liquid" notch cut into the card's corner (drawn as one SVG shape so the outline follows it).
  - **Polish:** dark-mode surfaces use outlines instead of shadows, tab indicators ease out without overshoot, reduced-motion handling in the remaining animated controls, Calendar, Steps, Avatar, Callout, Progress, Pagination and Code refinements.

- d49cb61: `Corkboard` — a keyboard-navigable, drag-reorderable card grid.

  A flat ordered list laid out as a grid of cards, with the card's content left to a snippet: the
  component contributes the grid, the cursor, the selection and the reorder gestures. Dragging a
  card — or a multi-selection, which moves as one run in screen order — into a gap calls
  `onreorder` with a plan (`ids`, landing `index`, `before`/`after` neighbours) rather than
  mutating anything, and the surrounding cards settle with a FLIP animation. A card marked
  `droppable` also accepts drops onto its middle half, reported as `ondropinto`.

  The keyboard walk is genuinely 2D — `↑`/`↓` step by the laid-out column count, read back off the
  cards, so it agrees with whatever CSS decided — and `mod`+arrows perform the same reorders the
  drag does. Selection reuses the shared model from `selection.ts` (`shift`/`mod` click,
  `shift`+arrows, `mod+a`, `escape`). One tab stop, `aria-current` cursor, a `role="status"`
  announcement named by `label_of`, and keys typed into a control inside a card are left alone.

  Drop geometry is honest about a grid's whole surface. A pointer over the gaps — between cards,
  between rows, in the ragged tail — resolves to the _nearest_ slot (`dropFromPoint`: row from y
  with ties to the nearer band, gap from the cards' midpoints), not to the end of the list. The
  indicator is anchored on the card the pointer's row actually contains, so a slot at a row
  boundary draws after that row's last card rather than before the next row's first; and at the
  grid's outer boundary — where there is no gap to centre in — the bar draws flush inside the
  card's edge instead of overhanging where a scrolling ancestor's `overflow` would clip it.
  Keyboard reorders go through `planKeyMove`, which steps a multi-selection from the run's edge —
  its last card moving toward the end, its first moving toward the front — so `mod`+arrow on a
  selected run means the same move a drag of that run means, never a silent no-op measured from
  the cursor's own other half.

  The grid arithmetic ships as a pure module beside it — `columnCount`, `arrowTarget`, `moveSlot`,
  `planKeyMove`, `insertionIndex`, `planReorder`, `planKeyMove`, `dropOnCard`, `dropFromPoint`.

  **Deliberately no barrel export.** Without a `sideEffects` declaration a barrel's modules ride in
  whatever chunk imports the barrel (DS-13's passenger tax, measured at 4.3KB gzipped of boot for
  this component alone in DelightWrite), so `Corkboard` gets the per-component export path DS-13
  asks for from birth: `@delightstack/components/display/Corkboard.svelte` and
  `@delightstack/components/display/corkboard-model` are in the `exports` map; the root and
  `./display` barrels do not name it.

- d49cb61: `DiffViewer` — a word-level diff of two texts, inline or side-by-side.

  Whole words are marked rather than characters, because prose reflows and a character diff of a
  rewritten sentence is confetti; `granularity` takes `'char'` and `'line'` for the cases where the
  unit is smaller or larger. Line numbers for both sides, a long unchanged stretch collapsed behind
  an expander at `context_lines`, `n` / `p` to step through the changes, and `wrap` /
  `show_line_numbers` / `max_height` for the shape of it.

  A caller that knows which parts of the two documents correspond — blocks paired by a stable id,
  rows paired by primary key — passes `hunks` instead of the two strings, and the alignment it
  worked out is the alignment that gets rendered. That includes a `moved` kind, which a text diff
  can never infer: it is recorded on every row it produces (`moved`, `moved_from`, `moved_to`, and
  `data-moved` in the DOM) and rendered in place with a rule down its leading edge. Drawing the pair
  as a move is not built.

  The alignment inside a changed span is anchored on the text the two sides share: every `equal`
  span lands in exactly one line on each side, and those pairs are the spine. Lines between two
  anchors pair from the top of the gap, so a wholly rewritten line stays one row rather than
  becoming a deletion followed by an insertion — and appending a line to a document leaves the line
  above it alone, which bottom-pairing did not.

  `buildDiffModel` and the rest of `diff-model.ts` are exported from
  `@delightstack/components/display` as a pure module — no runes, no DOM — so the same rows,
  sections and counts can be computed in a Worker or asserted in a test without mounting anything.
  `tokenizeGraphemes` comes with it: `@delightstack/diff` has no character tokenizer, and splitting
  by code point cuts a ZWJ family emoji into six pieces.

  `@delightstack/diff` is a new dependency of the package. It carries the Myers engine, the word
  tokenizer and the HTML renderer, all of which this uses as published — nothing was added to it.

  The diff inherits the type of whatever it sits in (`--diff-font` defaults to `inherit`), so a
  diff of a document is set in the document's own face rather than in a monospace box.

  **Moves are drawn as moves.** A move has two ends and a reader needs both, so a caller that knows
  one happened passes two `moved` hunks sharing `before_index` / `after_index`: one with
  `stub: true`, standing where the old document had the span, and the span itself where the new one
  has it. The span is drawn once, at the destination, labelled with the line it came from; the stub
  is a single dimmed line saying where the text went, with a dashed rule down its leading edge. The
  old side's line numbers go to the stub — that is where the old document put the text — so the
  numbers under a move stay true on both sides. `changed` marks a span that was edited on the way,
  and the word diff runs inside it as usual.

  Colour is not the signal. Both ends carry a `⇅` glyph and an arrow pointing the way the text went,
  because insertions and deletions have already spent green and red and a reader who cannot separate
  those two hues has nothing left to read a third by. `--moved` defaults to `--color-action`:
  `@delightstack/styles` has no info hue on purpose, and informational surfaces there are the action
  colour.

  Rows gained `moved_stub`, `moved_head`, `moved_changed`, `moved_from_line` and `moved_to_line` —
  the last two resolved after layout, so each end can name the other's line whichever way round the
  move landed. `data-moved` is now `from` on the stub and `to` on the span rather than an empty
  attribute; `[data-moved]` selectors are unaffected. A `moved` hunk passed without a stub renders
  exactly as it did before.

  **Two stops per move, and a hue of its own.** `n` / `p` step to the head of each run of change,
  which is right for eight rewritten lines in a row and wrong for a move: its two ends touch
  whenever two adjacent blocks swap, and folding them into one run lands on the stub, says "moved to
  line 3", and then skips line 3. Both ends are always their own stop now, and both are focusable.

  The move colour is derived from `--color-action` with its hue rotated 40° rather than taken as-is.
  Used raw it is the colour of the focus ring, the links and every other interactive affordance on
  the page, so a marked-up region of a document reads as something you can click. `--moved-fg` is a
  new foreground variant with its lightness clamped into a legible band — `--moved` is a surface
  colour and fails 4.5:1 as small type, the same split `--color-action-fg` makes for
  `--color-action`. Measured on the marker: 5.8:1 (chip) and 5.0:1 (stub) in light, 4.9:1 in dark.

  A `moved` hunk with `stub: true` and no `before_index` / `after_index` now throws a `DiffError`
  (`stub_without_indices`) in dev instead of pairing wrongly — the indices are the only thing that
  matches a stub to its span, so every such stub folds onto one key and pairs with the wrong row.

  `DiffViewer.test.ts` is the package's first component test: `render` from `svelte/server` and
  assertions against the markup, for the one thing the pure model cannot answer — which way a move's
  arrows point. See the README's Testing section for when that is the right tool.

### Patch Changes

- 0e77fe0: `BottomSheet`: content taller than the highest snap point scrolls by touch again. A sheet whose top snap was under the full screen height (the common `[0.6, 0.95]`) never counted as fully open, so its content kept `touch-action: pan-x` and an upward swipe dragged the sheet instead of scrolling; the panel was also as tall as the screen, so its last few percent sat off the bottom edge. The panel is now capped at the top snap's height, which makes that snap "fully open" and lines the scroll area up with the bottom of the screen. Also: a sheet with `blocking={false}` no longer sets `aria-modal`, so screen readers can still reach the page behind it.
- 8d69525: Every relative import in the built `dist/` is now a complete ESM specifier.

  The source files imported their siblings the way a bundler lets you — `from './error.helper'`,
  `from './helpers'`, `from './auth.client.svelte'` — and `svelte-package` copies specifiers
  through untouched, so the published `dist/` inherited them. Vite, esbuild and Rollup resolve
  those by probing for extensions and `index` files; Node's ESM loader does not. So the packages
  worked in every bundled context and failed the moment plain Node imported them — a SvelteKit
  SSR render step, a Vitest file that had not inlined the dependency, a one-off script — with
  `Cannot find module`.

  Relative specifiers now carry `.js` (a `.svelte.ts` rune module is `./x.svelte.js`), and
  directory imports name their `index.js`. `scripts/check-dist-specifiers.mjs`, wired into the
  root `build` and `test`, walks every `packages/*/dist/**/*.js` and fails the build on an
  incomplete relative specifier, so this cannot come back. No public API changed.

- d5a93c8: `Modal`: on a phone the body's side padding is 1rem instead of 0.5rem, so fields and text sit at the usual 16px gutter rather than 8px from the screen edge. The in-flow footer's negative margin follows, so its divider still runs edge to edge.
- Updated dependencies [8d69525]
- Updated dependencies [8d69525]
- Updated dependencies [d5e18d9]
- Updated dependencies [a6807b5]
  - @delightstack/diff@1.1.1
  - @delightstack/utilities@1.2.2
  - @delightstack/styles@1.2.0

## 1.10.0

### Minor Changes

- 5f2378c: `Input` takes `autocomplete`, `inputmode`, `autocapitalize` and `spellcheck` and passes them to the native field (input and textarea), so a one-time-code field can ask phones to offer the code (`autocomplete="one-time-code" inputmode="numeric"`) without reaching into the rendered element. A field with suggestions (`options`/`onfilter`) still uses `autocomplete="off"`.

### Patch Changes

- 0a0b2f6: `Table`: the inline cell editor no longer draws the global focus ring as a stray box inside the cell. It reset `outline` but not the `box-shadow` the global `*:focus-visible` rule draws; the cell's own editing ring is the focus cue.
- 350f17d: `Checkbox`: a label with a long description stays beside its box in a narrow container. The text block was sized to its max-content inside a wrapping row, so once the description was wider than the space left it dropped onto its own line under the box; it now shrinks and wraps its text instead.
- 630fce7: `Popover`: a `List` that is the popover's only content takes the popover's corner radius, so its items' hover and active highlights run concentric with the panel. A dense list kept its own smaller radius, and the first and last highlights came out tighter than the panel's corners.

## 1.9.1

### Patch Changes

- e2c3e92: `Tabs` `boxed`: the active thumb shows in dark mode. It used `--color-surface`, which in dark mode is the
  track's own color, so the selection all but vanished. In dark mode the thumb is now a neutral one step
  lighter than the track, with no shadow (a shadow doesn't read on dark); light mode is unchanged.
- e2c3e92: `Tabs`: the selection shows on first paint. The sliding indicator is placed by measuring the active
  tab, which can't happen until hydration, so a server-rendered `Tabs` showed no underline (or, `boxed`,
  no thumb) and faded one in afterwards. Until the indicator is placed, the active tab now draws the same
  mark itself in CSS; the indicator takes over in that same frame, with no fade, and glides as before.
- Updated dependencies [58bc069]
  - @delightstack/styles@1.1.2

## 1.9.0

### Minor Changes

- 7db93be: Input and Select save on commit: when `onchange` returns a promise, the field shows a spinner while it runs, a checkmark when it resolves, and the rejection's message as its error when it fails (cleared on the next edit). A fast save skips the spinner but still gets its checkmark; a newer change supersedes one still in flight. Text inputs commit on Enter or blur, as before.

### Patch Changes

- 097cd06: Range: no stray box around the whole slider when it has keyboard focus. The global focus ring landed on the invisible native input; the thumb's own focus ring is the only one now.

## 1.8.4

### Patch Changes

- 1ec0936: Buttons no longer flash disabled when they appear after the page has hydrated.

  A Button rendered `disabled` until its own effect ran, so a click couldn't land on server HTML
  before its handler was attached. That guard also applied to Buttons created later, on a
  client-side navigation for example. If the browser computed styles before the effect ran, the
  button faded out of its disabled colours over the 300ms background transition, which looked like
  a flash on every page switch. The guard now only applies while the page is first hydrating.

## 1.8.3

### Patch Changes

- 7d4a38b: Modal: a modal without a footer now has the same padding below its content as at its sides (2.5rem on desktop, was 2rem), so the last field no longer sits closer to the bottom edge than to the left and right.
- 7d4a38b: Popover: no more sideways jump as an arrowed popover finishes opening. The arrow shift (which keeps the arrow clear of the rounded corners) was measured from the panel's box while the open animation was still scaling it, then re-measured at full size; it now measures the laid-out box with the running transform taken out, so both agree.

## 1.8.2

### Patch Changes

- 2dc1c9c: Selected Button and focused field contrast:

  - Selected (`active`) outline and transparent Buttons get their own, deeper wash instead of sharing the hover tint. They no longer look merely hovered in a ButtonGroup, and they stay visible with a dark brand color in dark mode. Hovering a selected button no longer fades it back to the hover tint.
  - Icon-only end buttons in an attached ButtonGroup split their extra width across both sides (slightly more on the rounded end), so the icon sits centered in its segment instead of being pushed toward the group's middle.
  - Input and Select draw their focus border and floated label in `--color-action-fg` instead of `--color-action`, so focusing a field brightens it in dark mode rather than dimming it.

- Updated dependencies [2dc1c9c]
  - @delightstack/styles@1.1.1

## 1.8.1

### Patch Changes

- d2d430e: Tabs: light text on the active tab when `pills` and `boxed` are combined

  With both variants on, the active tab is filled with the action color (the pill), but the boxed
  variant's dark active text came later in the stylesheet and won, leaving dark text on a dark fill.
  The boxed text color now applies only when `pills` is off.

## 1.8.0

### Minor Changes

- b9668c0: `ThemeToggle` now applies the theme through `data-theme` on `<html>` instead of an inline `color-scheme`, so it works in production builds.

  Vite's default CSS minifier, Lightning CSS, lowers every `light-dark()` in `@delightstack/styles` to `var(--lightningcss-light, …) var(--lightningcss-dark, …)`. Only the stylesheet's own `color-scheme` rules set those variables (the `html` rule, the `prefers-color-scheme: dark` query and the `[data-theme]` rules), so the inline style the toggle wrote did nothing. In a production build the page followed the OS and the toggle only swapped its icon. Dev builds don't lower `light-dark()`, which is why the bug only showed in production.

  The toggle now sets `data-theme="light"` or `data-theme="dark"` for an explicit choice and removes the attribute for auto, the mechanism the styles README documents.

  **New prop `apply_theme`** (default `true`). Set it to `false` for a display-only toggle, such as a demo or preview: it still cycles, stores the choice and updates its own icon and label, but never touches `<html>`. The docs site's ThemeToggle demos use it, since a second toggle that removes `data-theme` for auto would strip the attribute Starlight's chrome depends on.

  **Migration:** if you copied the old anti-flash `<head>` script from the docs, change its `style.colorScheme` write to `document.documentElement.dataset.theme = saved` for a saved `light` or `dark` (the ThemeToggle docs have the new script). A leftover inline `color-scheme` overrides `data-theme` in dev and puts native controls on the wrong scheme in production. A page that keeps its own resolved `data-theme` on `<html>` (Starlight does) will see the toggle remove it when the choice is auto, so give every toggle other than the one in charge `apply_theme={false}`.

### Patch Changes

- Updated dependencies [2721e99]
  - @delightstack/utilities@1.2.1

## 1.7.0

### Minor Changes

- ddc93dc: Multi-select: a shared selection model

  A shared selection model, so a list-shaped component gets the whole multi-select gesture set
  without reinventing the part everyone gets wrong.

  **`selection.ts`** — a pure model, exported as `applySelection`, `extendSelection`,
  `selectionGestureOf`, `selectionSelectAll`, `clearSelection`, `selectionFromIDs` and
  `EMPTY_SELECTION`. No runes, no DOM: a caller passes the state it holds, the ids on screen
  in the order they are on screen, and the gesture, and gets a new state back. That makes it
  usable from `Tree`'s `$bindable` array, from `Table`'s row selection or from a consumer's
  own state, and it makes the rules testable without mounting anything.

  The part it exists for is the **anchor**. A range is measured from the item the user last
  committed to, and that item stays put while shift-clicks re-range around it — so a second
  shift-click narrows the range instead of ratcheting it outward, which is what happens when
  "the last id in the array" is treated as the anchor. `mod`-click moves the anchor even when
  it deselects, because the next range is measured from the last thing pointed at whether or
  not it survived the click.

  **`Tree`** now uses it whenever `multi_select` is set, which adds the keyboard half of
  multi-select to the pointer half it already had: `shift+↑/↓` extends the range from the
  cursor, `mod+a` selects everything visible, and `escape` clears — claimed only when there is
  a selection to drop, so `escape` still reaches the drawer or modal the tree is inside the
  rest of the time. Selected ids now come back in screen order however the selection was
  built, and a range no longer keeps rows outside it.

## 1.6.0

### Minor Changes

- be57fd5: `Tree`: a bindable `focused` prop, type-ahead, and keys typed into a control are left alone

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

### Patch Changes

- 9161971: `Tree`: collapsed branches are no longer rendered

  - The tree mounted every descendant it was given, expanded or not. A 10,000-node
    tree with two rows on screen put 10,520 `<li>` and 54,680 elements in the
    document, and every keystroke then paid for all of them: one arrow press cost
    ~28ms of main thread where the same press on the same tree now costs ~2ms.
    Collapsed branches are mounted when they open and unmounted once the closing
    animation has run, so DOM size follows what is open rather than how much data
    was handed in — the same fixture is now 20 `<li>` and 140 elements.
  - The expand animation grows `grid-template-rows: 0fr → 1fr`, which needs the
    rows to exist and their collapsed state to be committed before the open state
    is applied. Opening therefore takes two steps a style pass apart rather than
    one, and reduced motion skips straight to the open state as it did before.
  - Nothing changes for a consumer who was not hitting this: props, events and
    bindings are untouched, and a tree small enough to mount whole renders the same
    DOM once it is open. Code that reaches into the tree with `querySelector` will
    only find rows inside open branches.

## 1.5.2

### Patch Changes

- Updated dependencies [a3e0a38]
  - @delightstack/utilities@1.2.0

## 1.5.1

### Patch Changes

- Updated dependencies [d86752e]
  - @delightstack/utilities@1.1.0

## 1.5.0

### Minor Changes

- 9f90d3f: Video: lazy poster loading via a new `lazy` prop (default `true`).

  A bare `poster` attribute is fetched by the browser's preload scanner the moment the HTML is parsed — every below-fold player's poster joins the initial page load (on a page with a dozen inline players that's easily 1–2MB of screens-away JPEGs competing with the critical path). The poster attribute is now withheld until the player nears the viewport, riding the same one-shot ~150%-margin intersection observer the HLS attach gate already uses; play intent and `autoplay` also reveal it immediately, and platforms without IntersectionObserver fail open. Server-rendered HTML omits the poster while `lazy` is on, which is what keeps it out of the preload scanner. Set `lazy={false}` for above-the-fold players whose poster must paint with the first render (this restores the old behavior, poster present in SSR HTML included) — mirrors `Image`'s `lazy` prop, which also defaults to `true`.

## 1.4.1

### Patch Changes

- e5e9c4d: Gallery: stop thumbnail load handlers from firing after their tile is destroyed.

  The grid thumbnail `<img>`/`<video>` cleared their fade-in state from `onload`/`onloadeddata`/`onerror` attributes, which read the per-item `{@const key}` derived. A thumbnail still in flight when its tile unmounts (navigating away from a page, an item leaving the list) fires that media event on the now-detached element, so the handler ran after the item's derived was destroyed — logging `derived_inert` ("Reading a derived belonging to a now-destroyed effect") and writing state outside of Svelte's batch, which could in turn trip `invariant_violation: Batch has scheduled roots`.

  The listeners now live in an attachment that captures the key as a plain string and removes them on teardown, so nothing runs after the tile is gone. Teardown also drops the key from the fading set, so an item that leaves and later returns can't get stuck at zero opacity.

## 1.4.0

### Minor Changes

- 311531c: Gallery: animated video posters and a controllable outside gap.

  - **`poster_video` item field.** When set, grid/masonry/list thumbnails render a muted looping `<video>` instead of the poster `<img>`. This gives animated-image content (GIF/animated AVIF) with a video twin a hardware-decoded path in gallery tiles — animated images are decoded in software frame by frame, while an equivalent AV1/H.264 mp4 rides the hardware decoder. The tile video loads nothing until it nears the viewport (`preload="none"` plus an intersection observer), plays only while near, pauses when scrolled away, and under `prefers-reduced-motion` never plays (only a still first frame is fetched). `poster` (when also set) is used as the `<video poster>` while it loads, and the thumbhash blur/fade-in behaves exactly as it does for image tiles.
  - **`outside_gap` prop** (`boolean | undefined`, default `undefined` = "auto") controls the padding around the grid/masonry/masonry-row layouts that matches the interior gap. `true` always pads (the old behavior), `false` never pads, and auto keeps the gap only when the gallery is full-bleed — inside a narrower container the padding read as the gallery failing to fill its container, so auto drops it there. Auto is resolved in pure CSS (a clamp step function comparing the containing block against `100vw`, with 32px of slack for a classic desktop scrollbar), so it tracks resizes with no script.

## 1.3.0

### Minor Changes

- 7bb92d9: Gallery/Carousel: `custom` items are now first-class media. They get the same pinch-zoom / double-tap-zoom / wheel-zoom mechanics as images — the zoom matrix was already applied to the slide's content element generically, but `isScalable()` hard-excluded `custom`, which also made the documented `disable_zoom` escape hatch a no-op for the one type it was written for. A custom item that handles its own zoom still opts out with `disable_zoom`. Gallery grid/list thumbnails also no longer render an empty type-badge disc over `custom` items: the badge only appears for types that actually have an icon (video, pdf, embed, panorama).

## 1.2.1

### Patch Changes

- 87c4ff1: Video: keep the big play button clear of the title chrome on short players. When a `title` is set, the resting controls (title + control bar) own the bottom ~78px of a paused player — on a short player the centred 76px play button sank into that band. The button now lives in its own height-queryable layer: at ≤260px tall it recentres in the picture area above the chrome and steps down to 56px, and at ≤180px it steps down again to 44px. Players without a title, and tall players with one, are unchanged.

## 1.2.0

### Minor Changes

- e1076ea: Video: HLS sources now honor `preload`. Previously an HLS video attached its stream on mount — downloading the hls.js chunk, the manifest, and the first segments even with `preload="none"` and even far off-screen. Attachment is now gated: `preload="none"` defers all network activity until playback is actually requested (the play intent attaches the stream and starts playback in one click); `preload="metadata"`/`"auto"` attach once the player nears the viewport (IntersectionObserver, 150% margin, fail-open where IO is unavailable); `autoplay` still attaches immediately. Pre-play seeks on a deferred stream lift the gate so metadata can resolve, and changing `src` after attach still re-attaches as before.

### Patch Changes

- c7cddf1: Fix `Video` silently failing to play HLS in Chrome 150+. The player decided whether to use the browser's own HLS support by asking `canPlayType('application/vnd.apple.mpegurl')` and treating any non-empty answer as yes. Chrome 150 changed its answer from `''` to `'maybe'` while remaining unable to play a playlist, so every Chrome user got the playlist handed straight to the media element, which stalls at `readyState 0` and never fires an `error` — no playback, no error state, just a poster that does nothing when pressed. This affected `Gallery` and `Carousel` video slides too, since they render `Video`.

  Native playback now additionally requires the absence of Media Source Extensions, a combination that only holds on Apple's media stack. Everywhere MSE exists — including desktop Safari — hls.js drives the stream, which is the order hls.js's own docs prescribe. iPhones still take the native path and still never download hls.js. If hls.js declines the platform after loading, the element is tried as a last resort rather than going straight to an error.

## 1.1.1

### Patch Changes

- 7252eb4: Gallery's fullscreen caption no longer sits on top of a video's player controls. On a video slide the caption is no longer an overlay at all — Gallery hands it to the player, which draws it as part of its own chrome: directly above the control bar, under the same scrim, so one gradient carries caption and controls together instead of two scrims meeting in a visible seam. It appears and fades with the controls, so it's gone once playback runs and the pointer goes idle, and back on pointer move or pause. Image and PDF slides keep the bottom-pinned caption they had.

  Video gained a `title` prop for this (a short caption shown with the controls, distinct from the `captions` subtitle tracks), and Carousel a `caption_display` prop that forwards an item's caption to the player.

## 1.1.0

### Minor Changes

- fc32c0c: CommandPalette supports async command sources and external query control. A new `onquery` callback fires whenever the search query changes so a parent can fetch results from a server (debouncing is the parent's responsibility). Commands marked `dynamic: true` are treated as pre-filtered by their source: while a query is present they bypass the fuzzy filter and render, in the order given, after the scored static matches — title highlighting still applies to confident (non-fuzzy) matches. A `loading` prop shows "Searching…" instead of "No results found" while an external source is in flight. The `query` is now a bindable prop so a parent can prefill it (e.g. from a deep-link URL param) or mirror it into the URL; it resets when the palette closes rather than when it opens, so a prefill set alongside `open = true` survives.

### Patch Changes

- 12d7e4b: Fix low-contrast action-colored text and icons (most visibly in dark mode) when the brand seed is dark. `--color-action` is a _surface_ token — its lightness is clamped to a mid band (dark 0.4–0.6) so it reads as a fill under `--color-action-text`. Several components were using it directly as a **foreground** color on the neutral page/card background, which only stays legible when the seed happens to be light: the default `#10a6c4` seed squeaks past AA at ~4.9:1, but a dark seed lands at the clamp floor and drops to ~2:1 (failing WCAG AA).

  New semantic tokens `--color-action-fg` / `--color-accent-fg` (styles) provide a lightness-lifted foreground — the same lift the outline `Button` already applies to its own text — so accent text/icons stay ≥4.5:1 regardless of how dark `--color-primary` is. Components now use them wherever action/accent is text or an icon on a neutral surface: `Tabs` (active label + underline indicator), `Callout` (icon/title/dismiss/accent-bar, via a derived `--callout-fg`), `Stat`, `Code`, `PDF`, `Table` (pending status), `Fieldset` (hover), `FileUpload` (browse link), and `Toast` (info/loading). Paired backgrounds, borders, and focus rings still use `--color-action` unchanged.

- b8e988d: Button labels no longer wrap onto multiple lines when a flex container squeezes the button (`white-space: nowrap` on the base style). SplitPane pane bases now account for the divider's fixed 4px cross size — previously the two panes summed to a full 100% with grow/shrink locked to 0, pushing the second pane past the container's `overflow: hidden` edge and clipping ~4px of its content (e.g. right-aligned buttons losing their rounded corner); collapsed states reserve the divider space too.
- 96ab89a: CommandPalette's search input no longer shows a stray focus ring. The global `*:focus-visible` rule puts a 1px `box-shadow` on any keyboard-focused element, and the palette auto-focuses its input on open — the input reset `border` and `outline` but not `box-shadow`, so the ring drew an awkward box inside the already-framed palette. The input-wrapper's bottom border remains the focus cue.
- 2cedf54: Bug fixes across the library: Modal no longer fires `onclose` twice when closed via Escape/backdrop/X; Calendar guards `time_slot_interval <= 0` instead of freezing the tab; Avatar no longer crashes on whitespace-only names; Breadcrumbs escapes `<` in its JSON-LD script so item labels can't inject markup (XSS); Timeline infinite scroll re-arms after each load instead of firing exactly once; pie/donut Chart legends now toggle individual slices (they previously toggled datasets, leaving single-dataset legends inert); Steps unregisters steps on unmount so dynamic step lists keep correct indices; PDF download handles typed-array sources correctly. Context-driven components (ButtonGroup, Accordion, List, Timeline, Steps, Radio, Fieldset, FileUpload, Tabs, CommandPalette) now expose live prop values through their contexts instead of mount-time snapshots, so prop changes propagate to children without a re-sync tick.
- 90a9b4b: ContextMenu keeps its items mounted while the popover plays its close animation — previously the list unmounted the instant the menu state cleared, leaving an empty panel visibly scaling out. Breadcrumbs crumb Buttons (and the skeleton cells) now inherit the nav's `size-N` font instead of pinning `--control-font-1`, so at any non-default size the clickable crumbs match the current-item span; the current item's inline padding also now matches the sibling buttons (0.55em, 0.4em when dense).
- 0549bda: Press (`:active`) effects on large, full-width elements (Table rows, ListItems, Tree rows, Accordion headers, CommandPalette items, Select options) now use a two-axis scale instead of a uniform ratio: horizontally the element gives up a fixed `--press-shrink` (new token, default 20px) of width no matter how wide it is — computed as `1 - tan(atan2(var(--press-shrink), 100cqi))` — so a full-page row's edges never pull in by ~9% of a huge width; vertically it squashes by `--press-scale-y` (new token, default 0.85), which is what makes the press read as a press. All of these also share a consistent 2px downward nudge. Small controls (Button, chips, Tabs, Checkbox, etc.) are unchanged. Table's drag-lift start scale mirrors the new formula from the scroller width. Accordion headers now also play the standard ripple on click, matching ListItem/Button.
- 7d80054: Fix `Popover` mispositioning after re-anchoring: when `ref_element` changed while the popover was open, the previous element kept its `anchor-name` (it was only cleared on outro-end). With several elements sharing the popover's anchor name, CSS anchor positioning resolves to the last one in DOM order, so the panel could attach to a stale element — while the JS-positioned arrow still pointed at the current one. The anchor-name is now released from the old element the moment the popover re-anchors; closing still keeps it through the outro.
- 6596fd5: Tabs: vertically center the tab badge count. The badge flex-centers its content's line box, but a digit's ink sits low inside a `line-height: 1` box (the font's ascent+descent overflow it asymmetrically), so the number read a hair low. The count is now wrapped in an inner element trimmed with `text-box-trim: trim-both; text-box-edge: cap alphabetic`, so the box hugs the glyph and the flex centering lands on the ink itself. Progressive enhancement — browsers without `text-box` support keep the previous rendering.
- Updated dependencies [12d7e4b]
- Updated dependencies [0549bda]
- Updated dependencies [0c92f48]
  - @delightstack/styles@1.1.0
  - @delightstack/utilities@1.0.1

## 1.0.1

### Patch Changes

- 7334e7a: Input: make props and modes compose correctly. Autocomplete now works in `multiple` (chips) mode — typing in the chip draft opens and filters the panel (static `options` and async `onfilter`), Enter/click adds the suggestion as a chip (falling back to a raw chip when nothing matches), the panel stays open for picking several in a row, and already-added options are hidden. Also fixed: `multiple` with an undefined initial value fell through to a plain text input; `readonly` chips could still be removed via the remove button or Backspace; `type="number"` + autocomplete never opened the panel while typing and selection stuffed a label string into the numeric value; panel selection didn't sync the Form context value; the floating label overlapped an uncommitted chip draft on blur; and `maxlength`/`show_counter`/`mask`/`clearable` now apply to the chip draft. The chip input also gained the combobox ARIA wiring the single input already had.

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). Also surfaces `@delightstack/editor` in the agent-facing `SKILL.md` (adds an editor callout under "Beyond components") and fixes a stale `/stack/overview.md` docs link left over from the 2026-06 docs restructure.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/styles@1.0.0
  - @delightstack/utilities@1.0.0

## 0.2.0

### Minor Changes

- **Number stepper — compact footprint:** the increment/decrement buttons keep their full-size (~field-height) touch targets but pull together and into the field's end padding, roughly halving the pair's visual width.
- **Select — empty option values:** an option whose value is `''`, `null`, or `undefined` now empties the field. At rest the trigger reads as unselected (fixing the label/value double-render when the value matched an empty-string option); while the label is floated, the chosen empty option's label shows placeholder-styled so picking e.g. "None" gives visible feedback instead of looking like a no-op.
