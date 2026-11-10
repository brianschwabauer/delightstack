# @delightstack/editor

## 2.0.1

### Patch Changes

- Updated dependencies [3112675]
  - @delightstack/utilities@1.3.0
  - @delightstack/components@2.1.2

## 2.0.0

### Minor Changes

- 127fe66: Annotation decorations for highlights the host owns — `annotationDecorations()`, plus
  `resolveAnnotations`, `annotationCommands`, `annotationsInDocument`, `focusedAnnotation`,
  `annotationAnchorAt`, `nextAnnotation` and `previousAnnotation`. And, underneath both this and the
  tracked-changes plugin, a shared re-anchoring core: `resolveAnchors()`.

  A reader drags over a passage and it stays marked, in one of the host's colours, with an optional
  note beside it. **An annotation is not a mark**, and that is the whole design rather than an
  implementation detail: a mark lives in the document, so highlighting somebody else's article would
  be an _edit_ to it — in the history, in every device's sync queue, on a body the reader never meant
  to touch. So the host keeps a row and this plugin draws it, exactly the way `suggestionDecorations`
  draws a proposal, and for the same reason. Nothing here writes to the document.

  That decision settles the addressing without a second one being needed. A row cannot hold a
  position — the document moves and the row does not, and the reader who made the highlight was on
  another device six weeks ago. An annotation is `{block_id, quote, prefix, suffix}` and is re-found
  on every document change. Edit around a highlight and it follows its sentence; delete the sentence
  and it goes stale, which is reported through `onStale` and never dropped, because the quote is
  still the reader's.

  **`resolveAnchors(doc, items, anchorOf)` is new and is where the finding now lives.** Two features
  arriving at one algorithm is the case for extracting it: the block-text padding that keeps offsets
  real across inline atoms, the NFC/NFD spellings, the partial context score that lets a nearby edit
  degrade a match instead of erasing it, the home bonus that makes a named block outrank the rest of
  the document, and the refusal to let document order break a tie. It is generic in the caller's row
  type through an `anchorOf` projection, and `TextAnchor`, `ResolvedAnchor<T>`, `StaleAnchor<T>` and
  `HOME_BONUS` are exported for a host with anchored rows of its own — a comment thread, a bookmark.

  `suggestionDecorations` is refactored onto it with **no change to its surface**: `resolveSuggestions`
  still answers with `{resolved, stale, stale_details}`, `ResolvedSuggestion` still carries `kind`,
  and the whole of its existing test suite passes untouched.

  The differences between the two plugins are each deliberate. An **empty quote is refused** where an
  empty `find` is a legitimate pure insertion — a highlight over nothing would be a zero-width mark
  nobody can see, click, or remove. The highlight is an inline decoration and nothing else, carrying
  `role="mark"`, which matters here more than usual because colour is the entire visual signal and a
  listener gets none of it. A click is caught through `handleClick` rather than a DOM listener, since
  an inline decoration's DOM is the paragraph's own text nodes and there is nothing of ours to bind
  to; it returns `false`, because selecting a highlight is not handling the click and the caret
  should still go where the reader put it. Overlapping highlights resolve innermost first: a phrase
  marked inside an already-marked paragraph is the one that was meant.

  Colour is a class (`ds-annotation-<color>`) and never a value, because the palette belongs to the
  host — anything that is not a short run of word characters is dropped rather than escaped, since a
  colour is a palette entry's _name_. `--editor-annotation-*` custom properties carry defaults for
  five, so a consumer that sets nothing still gets a highlighter; light and dark are different
  pigments at the same hue rather than one wash at two alphas, because a pale yellow over a
  near-black page is a bright bar that inverts the page wherever it appears.

  `annotationAnchorAt(state)` is exported because _making_ an annotation is the host's and every host
  would otherwise write the same twenty lines slightly differently — which is fatal here: it records
  offsets into the same padded block text the resolver searches, so a highlight made now is a
  highlight found later. Its context comes from the block rather than the document, since a prefix
  that ran into the previous paragraph would stop matching the moment either paragraph moved.

  The note glyph is a widget, isolated with `stopEvent` and `ignoreSelection` — a widget's DOM lives
  inside the contenteditable, and without that the Enter that opened the note would also reach the
  keymap.

  No keys are bound; the focus and edit commands are exported for the host's own keymap. One
  difference from `nextSuggestion` worth knowing: while nothing is explicitly focused, `nextAnnotation`
  and `previousAnnotation` move _to_ the highlight at the caret rather than past it. Stepping through
  a review queue and reaching the thing you are standing in are different gestures.

  `resolveAnchors` takes an optional `AnchorCache` (`createAnchorCache()`), and both plugins keep
  one. It exists for a cost that is easy to miss: an anchor that _resolves_ is cheap, because the
  recorded block answers and the search stops — but an anchor that has gone **stale** finds nothing
  there and falls through to scanning every other block, and does it again on the next keystroke.
  Twenty stale anchors over a long document measured 3.7ms per keystroke, all of it re-deciding a
  fact that had not moved.

  The cache rests on one observation: a missing anchor can only come back in a block that _changed_.
  If an unchanged block held the text, it would not have been missing. So a previously-missing anchor
  is scanned against the blocks whose nodes are new — after a keystroke, one of them — and if it is
  still absent it is still missing, without the document being walked. Measured at 2.17ms → 0.16ms
  for that case. It deliberately caches neither `ambiguous` (a whole-document fact: deleting one of
  two identical paragraphs elsewhere resolves it) nor anything that resolved (whose range moves with
  every edit before it, and which was never the expensive case). Invalidation is by **node identity**
  rather than a version counter a caller could forget to bump — ProseMirror nodes are immutable, so a
  block that survived a transaction is the same object — which also means a cache handed a different
  document simply sees every block as new and takes the slow path.

  `annotationAnchorAt` now reports whether it clamped. A selection that runs past the end of its
  block is truncated to it, because an annotation is anchored inside one block and a quote spanning a
  paragraph boundary would have to survive both — but dragging across two paragraphs is an ordinary
  thing to do, so the clamp is reported (`truncated: true`, on the new `AnnotationAnchor` type)
  rather than applied in silence. Silently highlighting the first third of what somebody dragged over
  is the kind of thing they notice much later and cannot explain.

- 127fe66: Focus mode — `focusDim()`, an opt-in plugin that dims everything outside the unit of text the
  caret is in: the current `sentence`, `paragraph` or `block`. Decorations only, and deliberately:
  focus mode is a fact about one screen, not about the document, so nothing here writes a
  transaction, enters the history, or survives serialization — the same footing as
  `suggestionDecorations` and `annotationDecorations`.

  Sentence boundaries come from `Intl.Segmenter` (Baseline, dictionary-driven, no locale — the
  plugin does not know the document's language), with a best-effort abbreviation repair on top,
  because ICU's sentence break carries no suppression list and would end a sentence after `Dr.`.
  Dotted initialisms (`e.g.`, `p.m.`) and titles from a short explicit list (`Dr.`, `Mrs.`, `St.`)
  merge into the sentence that follows — a list, not a shape rule, so a sentence ending in a name
  or a month still ends where it ends. An environment without the segmenter degrades `sentence` to `paragraph`
  rather than throwing.

  The dimming is two kinds of decoration under one class (`ds-focus-dim`, or a host-supplied name):
  `Decoration.node` on every block outside the caret's unit — which reaches images, rules and code
  blocks the way an inline decoration cannot, and dims a whole subtree in one object — plus
  `Decoration.inline` inside the caret's own textblock for the sentence unit. Recomputation happens
  only when the selection or the document moves, and costs one walk of the caret's ancestors'
  children plus a segmentation of the one block the caret is in; every other transaction maps the
  existing set.

  The package ships **no opacity**: the right dimming is a function of the host's theme, so the
  class is the whole contract. The host toggles the mode with `setFocusDim(view, { enabled, unit })`
  — a meta-only transaction — and reads it back with `focusDimStateOf(state)`. `sentenceRangesIn` /
  `sentenceRangeIn` are exported for hosts (and tests) that need the boundaries themselves. No keys
  are bound, per the package's rule: the host's keymap runs the toggle.

- 127fe66: Bindings an app can replace, and the block commands its palette needs

  **`keymap`** — a factory on the editor options, handed `{ schema, editor }`, returning bindings
  that install **ahead** of the package's own. It is `input_rules` for keystrokes, and it exists for
  the same reason: an app with its own dialect disagrees with a shipped default and previously had
  nowhere to say so. `plugins` appends _after_ the keymaps, so a binding added there was shadowed by
  the one it meant to replace; block keymaps bind first but belong to a block. The concrete case is
  headings — the shipped `Mod-Alt-1` is a level-2 heading, because h1 is the page title in this
  package's model, and an app whose `#` means level 1 needs its keys to agree with its typing
  shortcuts. Anything the factory does not name keeps exactly what it ships with, and `Mod-z` still
  belongs to whatever the `history` option installed.

  **`moveBlock`, `duplicateBlock`, `insertLine` and `deleteLine` are exported.** They were bound by
  the shipped keymap and reachable no other way, so an app listing "Move block up" in a command
  palette had to reimplement it — two spellings of one command, drifting apart on the first fix.
  No behaviour changes: the keymap binds the same functions it always did.

  **`wrapIn` and `lift` are exported too.** `toggleBlockType` is `setBlockType` underneath, and
  `setBlockType` _throws_ on a node that is not a textblock — so it is not the toggle for a
  blockquote or a callout, and there was no other one. The pair that builds it belongs to
  `prosemirror-commands`, which a host reaches only through this package; re-exporting them is
  cheaper than every host taking a direct dependency to write six lines.

- 127fe66: Document surgery: `splitAt` and `joinDocuments`

  Splitting and joining a **block** were already covered — the block-id plugin has rules for both,
  and `backspaceCommand` joins two. Splitting and joining a **document** had nothing, so an app
  building a Scrivener-style "split this scene here" gesture had to reimplement cutting a
  `Fragment` in two and then get the block-id consequences right on its own.

  **`splitAt(doc, pos)`** answers with `{ head, tail }`, two documents of the same type. It cuts
  rather than slices, so a position inside a list or a quote gives two halves that are each still a
  list or a quote, and a cut inside a textblock splits it into two complete blocks. A position of
  `0` or `doc.content.size` gives one empty half rather than throwing — whether that means the
  gesture should be refused depends on whether it came from a keystroke or a menu, which is the
  app's to know.

  A wrapper the cut emptied is dropped rather than handed back — cutting in the gap before a list's
  first item would otherwise leave an empty `bullet_list` behind on the head side, and a
  `list_item+` node with no items is a document ProseMirror refuses to check, transform or
  serialize. The test is the node's own content expression, so an empty paragraph stays.

  **`joinDocuments(a, b, options)`** appends `b`'s content to `a`'s and takes `a`'s type and attrs.
  `separator` puts blocks between the two, and defaults to nothing: in a block document the blocks
  are already separate, and what a scene break or a rule _means_ belongs to the app's dialect.
  Trailing empty paragraphs are trimmed from `a` first, because a document being typed into ends in
  the caret's empty paragraph almost all of the time and that blank block would land exactly at the
  seam.

  Both are pure — node in, node out, no `EditorState` and no view. That is the point rather than a
  convenience: the two halves of a split do not live in the same editor. The head stays where it is
  and the tail is written into a document that has no editor open on it at all, which a `Command`
  could not have expressed.

  **Block ids survive both.** `splitAt` leaves the head's ids untouched and regenerates only those
  the tail would duplicate — the block the cut ran through — which is the rule splitting a paragraph
  with `Enter` already follows. `joinDocuments` leaves `a`'s alone and regenerates only those of
  `b`'s that `a` already uses. An id stays stable wherever it can, and is unique afterwards without
  exception.

- 127fe66: Passive term decoration — `termDecorations()`, a plugin that decorates every occurrence of an
  externally-owned term set (a glossary, a character register, a linter's word list) _passively_:
  invisible until revealed, a managed modifier-key reveal class, and a modifier-click activation
  callback that hands back the term's id. Decorations only, on the same footing as
  `suggestionDecorations`, `annotationDecorations` and `focusDim` — nothing here writes a
  transaction, enters the history, or survives serialization.

  The matcher is a **seam, not a built-in**. ED-09 was filed asking for a zero-dependency
  Aho–Corasick inside the package; what shipped is narrower: the host hands `match(text)` and the
  plugin owns everything positional. Matching rules — per-term case sensitivity, word boundaries
  beyond ASCII, possessives — are the host's dialect, and a host with a server-side matcher must
  decorate with the same code rather than this package's opinion of it. A `RegExp` over a short
  list is a perfectly good `match` for a glossary.

  The positional contract: each textblock hands `match` one string whose index `i` is exactly the
  ProseMirror position `block_start + 1 + i` — text nodes contribute their characters, any other
  inline child contributes U+FFFC per position it occupies (a hard word boundary), and text under
  a skipped mark (inline `code` by default) is masked to spaces of the same length; code blocks
  are skipped entirely (`termBlockText` is exported so hosts and tests can agree on exactly what
  was matched). Offsets come back and are spent as positions verbatim. Only the textblocks a
  transaction touched are re-matched; everything else is mapped. `setTermDecorations(view,
{ refresh: true })` re-matches the whole document when the term set changes; `{ always_on }`
  toggles the always-shown root class.

  The package ships **no styles**: decorations carry `ds-term` (or `class_name`) plus
  `data-term-id`, and the editor root carries `ds-terms-reveal` while the modifier is held and
  `ds-terms-always` while `always_on` is set — the host's CSS decides what a revealed term looks
  like. When decorated ranges overlap, a modifier-click activates the narrowest one under the
  pointer. No keys are bound.

- 127fe66: Tracked-changes decorations for suggestions the host owns — `suggestionDecorations()`, plus
  `resolveSuggestions`, `suggestionCommands`, `suggestionsInDocument`, `focusedSuggestion`,
  `nextSuggestion` and `previousSuggestion`.

  An agent (or a collaborator, or a linter) proposes an edit; the editor renders it inline as a
  strike over the text to be replaced and a widget carrying the text proposed in its place, with a
  small accept/reject chip and the proposer's note. **The plugin owns none of the data.** It reads a
  list the host supplies and calls back when the user decides; accepting is the host's edit to make,
  through whatever history the host has bound. Nothing here writes to the document, which is the
  property the feature exists for: a proposal is metadata, so a document's history stays clean until
  a person says yes.

  The addressing is the decision worth knowing about. A suggestion is anchored by
  `{block_id, find, prefix, suffix}` and **re-found on every document change**, not held as a mapped
  position. A proposal is made against text that was read elsewhere, by something that never had this
  editor open and so never had a position to take — there is only text to find again. Re-finding is
  also the behaviour the feature wants: edit around a suggestion and it follows the sentence it was
  about; delete that sentence and it goes stale, which is reported to the host through `onStale`
  rather than collapsing quietly to a caret. Stale suggestions are never dropped silently.

  The insertion half of a proposal is a **widget**, not an inline decoration, because the proposed
  text is not in the document and there is no range to decorate. Both widgets are isolated from the
  editor with `stopEvent` and `ignoreSelection`: a widget's DOM lives inside the contenteditable, and
  the chip contains focusable buttons, so without that a keystroke aimed at the accept button also
  reached the keymap.

  Matching tolerates Unicode normalisation. `find`, `prefix` and `suffix` arrive from somewhere else
  — over MCP, out of a JSON body, out of a projection that went through another runtime — and `café`
  has two spellings that are the same text and not the same string. Each is tried in both composed
  and decomposed form against the document's own text, which is left alone so the position arithmetic
  stays honest; the resolved range is the length of what the _document_ holds, not of the needle.

  A pure insertion anchors to whichever context it has: after `prefix`, or before `suffix` when there
  is no text before it, or at the front of the block the host named when it has neither. A resolve
  stops as soon as the recorded block answers, since a hit there outranks anything the rest of the
  document can score — which keeps a keystroke off the O(suggestions x document) path.

  Styling is nine `--editor-suggestion-*` custom properties with defaults derived from
  `--color-success` / `--color-error`, so a host that already has an insertion green and a deletion
  red hands them over instead of matching them by eye. Colour is never the only signal: the deletion
  is struck through, the insertion underlined, and the two chip buttons are a check and a cross.

  The file is `plugins/tracked-changes.ts` rather than `plugins/suggestion.ts` — that name belongs to
  the trigger menu (`/`, `@`, `[[`) and has since the package shipped. The exported factory keeps
  `suggestionDecorations`, which is what a consumer looks for.

  No keys are bound. Accept/reject/next/previous are exported as commands for the host's own keymap,
  because a table of editor shortcuts belongs to an app; the chip's own buttons are real `<button>`s,
  so Enter and Space already work on them without the package claiming a chord.

  A suggestion whose `find` occurs more than once with nothing to tell the copies apart goes **stale
  with reason `ambiguous`** rather than resolving to the first match. Document order is not a
  tie-break: the alternative to refusing is striking through a sentence in whichever paragraph came
  first and calling that a decision. `resolveSuggestions` now returns `stale_details` — each entry
  `{ suggestion, reason: 'missing' | 'ambiguous' }` — and `onStale` receives it as a second argument
  beside the bare list it always got, so a host that only wants to know _that_ something went stale
  does not have to unwrap every entry. A tie only survives when the context cannot break it:
  `prefix` and `suffix` score a point each and a named `block_id` outranks both, so the three things
  that disambiguate an `edit_document` find disambiguate this one too.

- 127fe66: The editor's type scale and vertical rhythm are now `--editor-*` custom properties — heading
  sizes, weight, leading and tracking; `pre` and inline `code` size, ground, radius, padding and
  leading; the blockquote rule and its indent; the list indent; and the gaps between blocks, around
  headings, between list items and before a nested list. Every default is the value that was
  hard-coded before, so nothing changes for a consumer that sets none of them.

  `undoInputRule` is re-exported from `prosemirror-inputrules` alongside the four rule helpers
  already there — it is what the package's own `Backspace` is chained from, so an app can test that
  one press undoes a rule it wrote against the real command.

  This exists for a host that renders the same document twice — a read-only projection before the
  editor mounts, and the editor after. The editor's rules are written as `.editor .ProseMirror h1`,
  three classes, which outranks a host's own container selector; before this there was no way for a
  host to declare the type once and have both states agree, so every heading, code block and quote
  resized the instant the editor mounted. `--editor-line-height` already worked this way and is why
  the leading survived; this is the rest of the scale, and the rhythm, the same way.

  One rule became two on the way: `li + li, li > ul, li > ol` is now `li + li` and `li > ul, li > ol`
  with a property each, because a nested list is a block inside its item rather than another item.

- 127fe66: Markdown hooks, and typing shortcuts an app can replace

  Two seams, both for the same kind of app: one that has its own markdown dialect and needs the
  editor to stop guessing at it.

  **`markdown`** — `{ looks_like?, parse?, serialize? }` on the editor options. `parse` handles
  plain-text markdown pastes in place of the package's own small parser, and `serialize` writes the
  clipboard's `text/plain` on copy and cut. `text/html` is untouched, so a paste back into an editor
  still takes the lossless path — which is also why, when a clipboard carries both flavours, HTML
  wins.

  The two details that make it usable rather than merely present: a parsed markdown paste now goes
  through `transformPasted` before it is inserted, exactly as a rich paste does, so the block-id
  rules apply to it too and an id off somebody else's clipboard is cleared rather than trusted; and
  `serialize` is handed the slice **after** `transformCopied`, so `<doc_id>:<block_id>` stamps are
  visible where they can be stripped before they leave the app.

  **`input_rules`** — `false` for none, or a factory handed the built-in rules (`baseInputRules`,
  now exported) that returns the list to install. Rules run in order and the first to fire wins, so
  a rule returned ahead of a built-in shadows it: that is how an app whose `#` means a level-1
  heading replaces one shortcut without giving up the dozen it agrees with. `InputRule`,
  `textblockTypeInputRule` and `wrappingInputRule` are re-exported so writing a dialect's rules
  needs no direct dependency on `prosemirror-inputrules`.

  A block's own `input_rules` are unchanged and still additive, and an editor built without either
  option installs the same plugins it did before.

  **Two behaviour changes that reach every consumer**, both on the plain-text markdown paste path
  and both fixes:

  - A parsed markdown paste now goes through `transformPasted`, where before it went straight to
    `replaceSelection`. Block ids on pasted markdown are regenerated rather than kept.
  - A parse that produces exactly **one paragraph** is now inserted into the textblock the caret is
    in, not as a block of its own. `` `code` `` or `[text](href)` pasted into the middle of a
    sentence used to split the paragraph in three; it no longer does. A heading, a list, or more
    than one block still pastes as blocks.

- 127fe66: Trigger menus take a trigger string, not a trigger character

  `editor.suggest()` and the `suggestion()` plugin behind it read `char` as a whole string now, so
  `[[` is one trigger. Three places assumed a width of one: the query was sliced from
  `index + 1`, the trigger position was computed as `pos - query.length - 1`, and the lookbehind
  window reserved a single character for the trigger. With a two-character trigger that put the
  replace range one character inside it — accepting a suggestion left a stray `[` in the paragraph —
  and the query carried the second bracket as its first letter.

  New option **`word_start`** (default `true`): whether the trigger has to begin a word. That rule
  is what keeps a `/` in the middle of a sentence a slash, and a multi-character trigger has much
  less to fear from it — `[[` is not typed by accident, and it legitimately follows an opening
  bracket or a dash. Single-character triggers are unaffected in every respect; the slash menu
  passes nothing and behaves exactly as before.

  Trigger menus also stay shut inside an **inline code span**. Only the code _block_ was checked
  before, so a `/` or a `[[` inside `` `like this` `` opened the menu — and a menu that inserts a
  node on accept would then replace the span's own text with one. Marks count as code when their
  spec sets `code` or when the schema names them `code`, which the package's own does.

### Patch Changes

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

- Updated dependencies [0e77fe0]
- Updated dependencies [d49cb61]
- Updated dependencies [1e8efb2]
- Updated dependencies [d49cb61]
- Updated dependencies [d49cb61]
- Updated dependencies [8d69525]
- Updated dependencies [d5a93c8]
  - @delightstack/components@2.0.0
  - @delightstack/utilities@1.2.2

## 1.2.1

### Patch Changes

- Updated dependencies [b9668c0]
- Updated dependencies [2721e99]
  - @delightstack/components@1.8.0
  - @delightstack/utilities@1.2.1

## 1.2.0

### Minor Changes

- aa84486: `@delightstack/crdt/prosemirror`: a hand-written Loro ⇄ ProseMirror binding

  A new entry point binding a `LoroDoc` to a ProseMirror `EditorState`. It lives in the CRDT
  package, not the editor, so `@delightstack/editor` never takes a wasm dependency;
  `prosemirror-model` and `prosemirror-state` are optional peers, so `/server` and `/client`
  bundles never see ProseMirror either.

  `loro-prosemirror` was the reference, not the implementation. Four things it does
  differently, each of which had to be a rewrite rather than a patch:

  - **Writes are reconciled, not rewritten.** Typing one character emits one Loro operation.
    Replacing a paragraph's text container because a character changed would destroy every
    concurrent edit inside it and mint a fresh container per keystroke.
  - **Remote changes arrive as minimal ProseMirror steps.** The projection reuses the same
    node objects for untouched subtrees, so the diff finds the changed range by reference
    comparison — not `tr.replace(0, doc.content.size, …)`, which throws away decorations and
    node views on every remote keystroke.
  - **The caret is anchored _before_ the import and restored in the same transaction.**
    Upstream builds its Loro `Cursor` from the absolute position after importing, so it
    anchors to whichever character slid into that offset, then restores a tick later in a
    `setTimeout`. Measured: caret at 11, a peer inserts five characters at 0, caret still
    reads 11 and the next keystroke lands mid-word. It now reads 16.
  - **Undo is Loro's `UndoManager`, scoped to the local peer.** `prosemirror-history`'s stack
    is a list of steps applied to _this editor_, including a collaborator's paragraph and an
    agent's rewrite, so `Cmd+Z` deletes someone else's work. Peer scoping alone is not enough:
    undoing an operation that _created a container_ deletes the container, and a deleted
    container takes every concurrent edit inside it. So containers are created in their own
    commit under an origin the undo manager excludes, and an undo step holds only the
    characters somebody typed. Undoing block creation still removes the block — that is a
    structural edit the user made.

  Also exported: `pmDocFromLoro` / `writePmDocToLoro` for a `pm_doc` projection with no editor
  attached, `pmDocAtFrontier` + `restorePmDoc` for restoring a version that survived
  compaction only as a snapshot (the server's `revertTo` cannot reach those), and
  `crdtBindingFromDoc` for driving a bare `LoroDoc`.

  **`@delightstack/editor`:** the `history` factory may now return a `HistoryImplementation`
  (`{ plugins, undo, redo, canUndo, canRedo }`) instead of a bare `Plugin[]`. It takes over
  `Mod-z`/`Mod-y`/`Mod-Shift-z`, `undo()`, `redo()`, `can_undo` and `can_redo` as a set —
  previously a factory replaced the plugin but left the commands and the reactive flags
  pointing at a `prosemirror-history` that was no longer installed, so the toolbar reported
  an undo depth of zero and `editor.undo()` silently did nothing. Existing `history` values
  (`false`, an options object, a `Plugin[]` factory) are unchanged.

## 1.1.0

### Minor Changes

- 830da80: `block_id` now survives a cross-document paste correctly, and `Editor` takes a `doc_id`.

  A block id is only useful if it names exactly one block. The plugin already guaranteed that _within_ one document — it detects duplicate ids after every transaction and regenerates the copy, keeping the id on whichever node existed before. But a block pasted in from a **different** document is not a duplicate of anything locally, so its id passed through untouched, and the same id then named one block here and a different block there. Block references, comment anchors and presence focus all resolve by id, so this is a silent aliasing bug rather than a cosmetic one — and it only shows up once an app edits more than one document, which is exactly when it stops being recoverable.

  Provenance cannot be recovered from the pasted block alone, so it now travels with it: `transformCopied` rewrites each id to `<doc_id>:<block_id>` on the way out, and `transformPasted` keeps the bare id only when the prefix matches this editor's `doc_id`, clearing it otherwise so the existing assignment pass mints a fresh one. An id arriving with no stamp — foreign HTML, or another app writing its own `data-block-id` — is never trusted. `doc_id` defaults to a per-instance id, so an app that does not set it gets regeneration on every paste from elsewhere: the safe direction, since a spurious new id costs an anchor while a spurious shared id corrupts one.

  Ids are now `generateTimestampID({ length: 12 })` rather than a hand-rolled base36 string. The timestamp prefix makes them sort by creation, which structural diff wants anyway, and `generateTimestampID` bumps an internal counter within a millisecond, so a bulk paste cannot collide with itself. Existing ids are opaque strings and keep working.

  Split and join were already correct; there are now tests saying so.

## 1.0.4

### Patch Changes

- Updated dependencies [a3e0a38]
  - @delightstack/utilities@1.2.0
  - @delightstack/components@1.5.2

## 1.0.3

### Patch Changes

- Updated dependencies [d86752e]
  - @delightstack/utilities@1.1.0
  - @delightstack/components@1.5.1

## 1.0.2

### Patch Changes

- b1c1b0e: Bug fixes: inserting multiple files at the selection (paste or multi-select picker) no longer keeps only the last file — each upload placeholder now inserts after the previous one; the block gutter's actions menu re-resolves the block position at action time, so Delete/Duplicate/Move/turn-into can't corrupt the wrong content after edits shift positions; duplicating a block upward no longer transfers the original's `block_id` to the copy (dedupe now maps the pre-existing node's position forward, so anchors stay on the original); `getJSON()` substitutes an empty-paragraph doc instead of emitting a schema-invalid `content: []` while a lone upload is in flight; touch drag can no longer strand itself (stuck drop indicator + runaway auto-scroll loop) when the pointer leaves the container; GalleryBlock aborts in-flight uploads on unmount instead of silently losing them.
- 0c92f48: Type-level fixes so consumer apps typecheck cleanly: the database schema's `Table` constraint no longer degenerates into an impossible `table_definition` union when a field generator's shape is `any`, and `StringFieldInputType` now matches the runtime (`tel` / `datetime-local` instead of `phone` / `datetime`); stripe's `PlanDefinition.entitlements` accepts `readonly string[]`; the images and ai request handles and utilities' `createDevHandle` are now generic over the event so they compose with SvelteKit's `Handle` without casts; the editor package no longer emits an `Editor` component export shadowed by the `Editor` class type (which made the component import type-only for consumers).
- Updated dependencies [12d7e4b]
- Updated dependencies [b8e988d]
- Updated dependencies [fc32c0c]
- Updated dependencies [96ab89a]
- Updated dependencies [2cedf54]
- Updated dependencies [90a9b4b]
- Updated dependencies [0549bda]
- Updated dependencies [7d80054]
- Updated dependencies [6596fd5]
- Updated dependencies [0c92f48]
  - @delightstack/components@1.1.0
  - @delightstack/utilities@1.0.1

## 1.0.1

### Patch Changes

- Updated dependencies [7334e7a]
  - @delightstack/components@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
- Updated dependencies [8420739]
  - @delightstack/components@1.0.0
  - @delightstack/utilities@1.0.0

## 0.2.0

### Minor Changes

- Initial release of `@delightstack/editor` — a ProseMirror-based block editor for Svelte 5.

  - Slash command menu with fuzzy search, plus an add-block (`+`) gutter menu
  - Single gutter drag handle with a gliding drop indicator, per-item drag, and touch reorder
  - Block toolbars that swap into task-specific modes (`BlockSpec.chrome_modes` + `ui.chrome_mode`) instead of overlaying UI on the block
  - Instant selection toolbar with Popover-style menu entrances and motion polish (selection rings, todo pop, reduced-motion support)
  - Media blocks: image crop + focal-point reposition, gallery captions (hidden / on hover / always), click-to-activate embed facades, optimistic uploads
  - Breakout block widths (`normal` / `wide` / `full`) with magnetic resize snaps, tokenized via `--editor-wide-width` / `--editor-full-width`
  - Live syntax highlighting in editable code blocks
  - Responsive sizing, click-below-to-append, a mobile toolbar, and line-editing shortcuts (duplicate, insert, delete, jump)
  - Server-side renderer that emits self-contained markup for published pages
