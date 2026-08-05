# @delightstack/components

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
