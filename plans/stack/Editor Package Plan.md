# @delightstack/editor — Rich Text / Block Editor Package

## Context

Many of Brian's apps need rich text editing. Rather than adopting tiptap/lexical/blocknote, we build it "the delightstack way": a Svelte 5 block editor on **raw ProseMirror**, with delightful UX (magnetic resize, drop animations, optimistic uploads), simple DX (one `BlockSpec` object registers a block everywhere), and clean seams for the delightstack backend packages (images, ai, websocket/presence, database) — all of which stay **optional**.

Prior art: the tiptap editor in `~/Work/brianschwabauer` (`src/lib/components/editor/`). Patterns to keep (rebuilt better): Svelte-mounted node views, optimistic upload placeholder swap, magnetic snap resize, Svelte-owned slash menu with a thin PM keydown-router plugin, zero-dep server `renderDoc.ts`. Pain to fix: copy-pasted 600-line imperative NodeView classes, CSS-custom-property-as-RPC hacks, hard-coded snap constants, dual data shapes for gallery items. Once shipped, the website repo migrates to this package.

**Locked decisions** (confirmed with user):
- **Raw ProseMirror** (prosemirror-model/state/view/commands/history/inputrules/keymap/schema-list/dropcursor/gapcursor/transform). No tiptap.
- **Collab = prosemirror-collab + Durable Object authority** over @delightstack/websocket (no Yjs). Persisted steps ⇒ version history + comment anchoring.
- **V1 = core editor** (this plan's build scope). Collab/presence/AI/comments/versions/mentions/layout are later phases, but v1 ships their seams.

## Package scaffold

`packages/editor/` mirroring `packages/presence` exactly (the reference template):
- `package.json`: name `@delightstack/editor`, `svelte-package -i src` build/dev, vitest, svelte-check. Copy `packages/presence/vite.config.ts` (`svelteRunesModules()` plugin) for testing `.svelte.ts` runes files.
- **deps**: `@delightstack/utilities` + all `prosemirror-*` as regular dependencies. **peerDeps** (optional via peerDependenciesMeta): `svelte ^5.36`, `@delightstack/components`. **No** dependency on images/ai/websocket/presence/database — backends go through interfaces (`Uploader` now, `EditorTransport` later).
- **exports map**: `.` (everything), `./core`, `./components`, `./blocks`, `./types`, `./schema` (isomorphic, no Svelte — worker-safe), `./render` (zero-dep, no svelte/prosemirror imports — server/worker-safe).

```
packages/editor/src/
├── index.ts
├── types/index.ts            # JSONContent, BlockSpec, EditorCommand, Uploader, EditorTransport, SnapPoint…
├── schema/index.ts           # ISOMORPHIC: buildSchema(specs), schemaHash(specs), base nodes/marks (worker-safe)
├── core/
│   ├── editor.svelte.ts      # Editor class (runes-reactive)
│   ├── block-spec.ts         # defineBlock() / defineBlockSchema()
│   ├── registry.svelte.ts    # CommandRegistry (reactive, fuzzy search)
│   ├── commands.ts / builtin-commands.ts / keymap.ts / input-rules.ts
│   ├── node-view/svelte-node-view.svelte.ts   # NodeView↔Svelte bridge
│   └── plugins/
│       ├── placeholder.ts    # empty doc/block placeholder decorations
│       ├── suggestion.ts     # generic trigger-char plugin ('/' now, '@' later)
│       ├── drag-handle.svelte.ts + drop.ts    # gutter handle, dropcursor, FLIP drop animation
│       ├── upload.svelte.ts  # optimistic placeholder nodes + progress
│       ├── paste.ts          # Word/GDocs sanitizer, URL routing, markdown paste
│       └── link.ts
├── blocks/                   # BlockSpec defs: image, gallery, video, audio, callout, code-block, embed, file, hr
├── components/
│   ├── Editor.svelte, Toolbar.svelte, FloatingMenu.svelte, SlashMenu.svelte, PlusButton.svelte
│   ├── BlockWrapper.svelte   # shared interactive-block chrome (ring/drag/resize/settings/delete)
│   ├── SettingsPopover.svelte, LinkEditor.svelte, CommandMenu.svelte (shared by slash+plus)
│   └── blocks/*.svelte       # ImageBlock, GalleryBlock, VideoBlock, CalloutBlock, CodeBlock…
└── render/index.ts           # renderHTML(doc, opts), renderText(doc) — zero-dep string walker
```

## Key APIs (the make-or-break DX surfaces)

### Editor class (`core/editor.svelte.ts`)
Runes-reactive; all PM→Svelte sync happens in one `dispatchTransaction` funnel (extensions can wrap it — collab seam).

```ts
class Editor {
  // reactive: doc (lazy-serialized), selection, active_marks, active_block,
  //           can_undo, can_redo, is_empty, focused, editable, uploads
  // escape hatches: view, state, schema, commands (CommandRegistry), blocks
  mount(dom); destroy();
  setContent(doc, {add_to_history?}); getJSON({strip_uploading = true}); getText();
  run(name, params?); exec(pmCommand); toggleMark(); setBlock(); insertBlock();
  updateNodeAttrs(pos, patch); deleteNode(pos); focus(pos?);
  // phase-2 seams:
  setDecorations(key, build)      // multi-source DecorationSets (presence/comments)
  registerPlugins(plugins)        // state reconfigure
  setState(state, {readonly?})    // full swap (version preview)
  pluginState(key)                // reactive derived plugin values (e.g. collab version)
}
interface EditorOptions {
  content?; blocks?: BlockSpec[]; default_blocks?: false | string[];
  commands?; uploader?: Uploader; editable?; placeholder?;
  plugins?: (ctx) => Plugin[];
  history?: false | opts | ((schema) => Plugin[]);  // collab injects here; ordering owned by one plugin array
  paste?: { markdown?: boolean; transform_html? }; link?: {...};
}
```

### BlockSpec — one object registers a block everywhere
`defineBlock<Attrs>()` bundles: `name`, `schema` (raw NodeSpec — **plain data**, must stay JSON-ish/worker-safe), `component` (Svelte node view), `interactive` (selectable/draggable/deletable/resize with **configurable SnapPoints** `{value, label, engage_radius=60, escape_radius=100}`), `settings` (declarative `SettingsField[]` rendered by SettingsPopover with components' Input/Select/Toggle/Range, or a custom Svelte component), `commands` (EditorCommand[] → appears in slash/plus/toolbar), `keymap`, `input_rules`, `paste: {match_url, match_file}`, `render` (server-safe string renderer), `render_text`.

**Isomorphic split (collab-ready)**: `defineBlockSchema()` returns the `{name, schema}` half; `defineBlock()` composes it with UI. Apps that want collab later put schema defs in a shared file the Worker can import; `./schema` exports `buildSchema(specs)` + `schemaHash(specs)` (drift guard: server rejects steps with mismatched hash). Docs show this pattern from day one.

`BlockProps` passed to node-view components: `{ attrs ($state, mutated in place), selected, editable, editor, pos(), update_attrs(patch), delete_node(), open_settings(), content (attachment marking contentDOM) }`. **Props in, transactions out — no CSS-var RPC.**

### CommandRegistry
`EditorCommand { name, label, icon?, keywords?, group?, keyboard?, surfaces? ('slash'|'plus'|'toolbar'|'floating'), is_active?, is_enabled?, run(editor, ctx) }`. One definition powers slash menu, plus menu, and toolbar. Zero-dep fuzzy `search()` (~40 LOC subsequence scoring).

### Uploader interface
`upload(file, {kind, signal, on_progress}) => Promise<UploadResult>` where `UploadResult.image` is ImageRecord-compatible (`id, width, height, aspect_ratio, thumbhash, background_color, variants`) so wiring @delightstack/images is one line (`toImageProps`/`imageURL`), but the editor never imports it. Gallery attrs use **one data shape**: `items: UploadResult['image'][]`.

### renderHTML (`./render`)
`renderHTML(doc, {blocks?, marks?, image_url?, link_attrs?, class_prefix?})` + `renderText(doc)`. Zero-dep recursive walker (modeled on website `renderDoc.ts`), strict escaping, skips `uploading:true` nodes. Built-in block renderers authored here and referenced by each BlockSpec — one renderer per block for both SSR and public pages. `<Editor>` SSRs `renderHTML(content)` and swaps to the live view on mount (no layout shift).

## Behavior highlights

- **Schema**: doc, paragraph, heading(1–6; UI offers 2–6), bullet/ordered lists, todo_list/todo_item(checked), blockquote, code_block(language), hr, hard_break; marks bold/italic/underline/strike/code/link(inclusive:false). Deliberately **no color/font marks**. **Every block node gets a stable `block_id` attr** (phase-2 seam: presence focus, comments fallback anchor, FLIP animation keys).
- **NodeView bridge**: wrapper `dom` created by the bridge (never component root); `contentDOM` assigned synchronously via `content` attachment; `update()` mutates one `$state` props object (never re-mounts); `unmount(…, {outro:false})`; `stopEvent`/`ignoreMutation` blanket everything outside contentDOM. `update_attrs` during resize drags coalesced to one undo step via a `resize-live` meta + appendTransaction.
- **BlockWrapper**: shared chrome — selection ring (tokens: `--color-primary`, `--radius`), drag-handle registration, pointer-capture resize with **gravity-eased magnetic snapping** (smoothstep toward engaged SnapPoint, hysteresis engage/escape radii; all constants from the spec, none hard-coded), settings gear → Popover, delete.
- **Drag & drop**: single shared gutter handle outside the contenteditable, positioned via hover tracking (`posAtCoords`); dragstart sets NodeSelection + `view.dragging = {slice, move:true}` so **PM's native drop logic** handles position resolution (depth-aware, nested lists/containers — phase-2 layout seam satisfied); `prosemirror-dropcursor` styled with tokens for the indicator; FLIP animation (~180ms transform) on drop transactions. PlusButton shares the hover tracking.
- **Uploads**: optimistic **real placeholder nodes** (`uploading:true, upload_id, blob_url`, client-read dimensions) — PM maps them through edits/moves/undo for free; on completion find by attr scan → `setNodeMarkup` with `addToHistory:false`; deletion during upload aborts via appendTransaction watcher; failure flips node to error state with retry/remove; `getJSON()` strips uploading nodes. Progress shown on the block via reactive `editor.uploads`.
- **Paste**: `transformPastedHTML` scrubs Word/GDocs (mso- styles, docs-internal-guid unwrap, style→semantic promotion); files→upload flow; URL over selection→link mark; URL on empty block→block `match_url` (embeds) else link; plain-text markdown heuristic parse (internal ~150-line parser, no dependency). Markdown-style input rules while typing.
- **IME safety rules (package-wide)**: nothing dispatches or opens/moves UI while `view.composing`; suggestion closes on compositionstart; menus in Portals outside the contenteditable; decorations only, never DOM mutation in the editable.
- **Read-only**: `<Editor readonly>` — same schema/components, chrome hidden via `editable` prop; public no-JS pages use `renderHTML` instead.
- Deferred from v1: editable tables (follow-up via prosemirror-tables), multi-block drag (structured so it's only a selection-resolution change), markdown export.

## Delight ideas (sprinkle through build, not a separate phase)

- FLIP drop animation + subtle "settle" on dropped block; drop-cursor line with a soft glow.
- Magnetic snap resize with labeled ghost badges ("wide", "full") while dragging.
- Upload progress as a radial sweep over the blurred thumbhash preview; success = quick shimmer-out.
- Slash menu with per-group icons, recents-first ordering, and preview hints; empty-paragraph ghost hint ("Type '/' for commands").
- Squircle corners + radius-cap conventions from the design system on all chrome (BlockWrapper ring, menus).
- Hover transitions follow the components convention: instant color-in, 300ms ease-out.

## Build order (within v1 — demo works early)

1. **Scaffold + text core**: package files, `./schema` base schema, Editor class + `<Editor>`, keymap/history/gapcursor/dropcursor/input-rules, placeholder plugin, example-app `/editor` route. Typing works day one.
2. **Command layer**: CommandRegistry, built-ins, `suggestion.ts`, SlashMenu, Toolbar, FloatingMenu + LinkEditor, PlusButton.
3. **NodeView framework**: bridge, BlockWrapper (ring/settings/delete), first blocks: hr, callout (contentDOM case), code_block (Code component).
4. **Uploads + media**: Uploader interface, upload plugin, ImageBlock with placeholder/progress/snap-resize; then video, audio, file, gallery, embed.
5. **Movement + paste**: drag handle + FLIP drop, Word/GDocs sanitizer, markdown + URL paste routing.
6. **Ship polish**: `./render` goldens, readonly + SSR swap, docs pages, README + manual QA checklist.

## Phase-2+ architecture (designed now, built later — v1 must ship these seams)

Phases in dependency order: **2A Collab → 2B Presence cursors / 2C Comments / 2D Versions / 2E AI**, 2F Mentions+Layout anytime.

- **2A Collab**: `editorSync(host, {extensions, storage, ws, auth, snapshot})` in the app's WebsocketServer DO; SQLite tables `editor_docs` (materialized head), `editor_steps`, `editor_snapshots`; ws events `editor:open/steps/ack/reject/update/pull`; dumb authority (version mismatch → reject, client rebases via prosemirror-collab); compaction + auto-snapshots via `alarm()`. Client: `EditorTransport` interface + `websocketTransport(ws, doc_id)` + `collabExtension(transport)`; history stays collab-aware natively. Note websocket `max_message_bytes` (64KB default) — chunk large step batches.
- **2B Presence**: selections piggyback on `presence.setState({custom: {editor: {doc_id, anchor, head, version}}})`; remote carets/selections as widget+inline decorations colored per user; **version-keyed Mapping ring buffer** (built in 2A) maps peer positions to local version. Presence package tweaks: typed/merging `setCustom`, export `colorForUser`.
- **2C Comments**: **external anchor table** (not marks) — `comment_threads {anchor_from, anchor_to, anchor_version, block_id fallback, quoted_text, status}` + `comments` in @delightstack/database (realtime free via entity broadcasts); server maps anchors through steps via `editorSync`'s `onSteps(mapping)` hook; orphan chain: range → block_id → quoted_text.
- **2D Versions**: named + auto snapshots from persisted steps; `getDocAt` = nearest snapshot + replay; preview = readonly state swap; diff via prosemirror-changeset (`renderChangeset` shared with 2E); restore = one new step, history never rewritten.
- **2E AI**: `aiExtension(aiClient)` — floating "Ask AI" + `/ai` commands; streaming into the doc via mapped insertion cursor, rAF-batched chunks, one undo group; **suggestion mode** = shadow `{base_version, steps[]}` rebased through live mappings, rendered with the changeset decorator, accept = dispatch steps.
- **2F Mentions**: `@` trigger reusing `suggestion.ts` with async source; atom mention node + avatar chip; app-provided `search`/`onMention`. **Layout**: `layout > layout_column{2,4} > block+` with width attrs (collab-safe LWW), resizable gutters; canvas/absolute mode is additive later via `mode` attr.

**V1 seam checklist** (all included above): ① isomorphic schema/`schemaHash` split ② `EditorTransport` type + construct-from-`{doc, version}` + `pluginState()` ③ injectable history / single plugin array / wrappable dispatchTransaction ④ `block_id` on blocks ⑤ generic trigger menu with async sources ⑥ multi-source decorations ⑦ readonly + `setState` swap ⑧ `getText`/`renderText` ⑨ PM-native (depth-aware) drop resolution.

## Files to create/modify

- **New**: everything under `packages/editor/` (structure above).
- **Modify**: `apps/example-app` — add `/editor` playground route (Editor + images-backed demo Uploader + custom `defineBlock` example + JSON inspector + readonly toggle) and `/editor/rendered` SSR route; check the dev script's turbo `--filter` list so the new package's `svelte-package -w` runs (workspace-dist-watch gotcha).
- **Docs**: `apps/docs` pages for Editor, BlockSpec guide, Uploader, renderHTML (+ demos in `src/components/demos/`), per existing mdx conventions; update components SKILL.md pipeline if applicable.

**Reference files**: `packages/presence/package.json` + `vite.config.ts` (template), `packages/images/src/image-helpers.ts` (ImageRecord shape), `~/Work/brianschwabauer/src/lib/server/renderDoc.ts` (renderer reference), `~/Work/brianschwabauer/src/lib/components/editor/*` (prior-art UX to beat), `apps/example-app/server/src/index.ts` (DO composition for phase 2A later).

## Verification

- **Unit (vitest + happy-dom)**: schema build/collisions/parseDOM round-trips; commands & input rules via pure `EditorState.apply` tests; registry fuzzy search; render goldens for every node/mark incl. escaping + uploading-strip; paste sanitizer against captured Word/GDocs HTML fixtures; upload plugin with mock Uploader (insert/swap/delete-aborts/strip); Editor reactivity via happy-dom-mounted view + `flushSync`.
- **Manual via example-app `/editor`** (things happy-dom can't do): typing/IME, menu positioning (coordsAtPos), drag+FLIP feel, resize snapping, real clipboard, focus edges. Keep a QA checklist in the README. Note: verify in a foregrounded tab (automated-tab-suspends-rAF gotcha).
- **Monorepo**: `pnpm build`, `pnpm test`, `pnpm check` (turbo), plus `pnpm dev:example` for the playground.
