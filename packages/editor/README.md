# @delightstack/editor

A delightful rich text / block editor for Svelte 5, built on raw ProseMirror. Slash commands, floating selection menu, drag-handle reordering with FLIP animations, magnetic snap resizing, optimistic uploads with progress, markdown shortcuts and paste, and an extensible block system — with a zero-dependency server renderer for public pages.

## Quick start

```svelte
<script lang="ts">
	import { Editor as EditorClass, defaultBlocks } from '@delightstack/editor';
	import { Editor, Toolbar } from '@delightstack/editor/components';

	const editor = new EditorClass({
		blocks: defaultBlocks(),
		placeholder: 'Write something…',
		content: saved_doc, // ProseMirror JSON (or null for an empty doc)
		uploader,           // optional: enables image/video/audio/file blocks
	});
</script>

<Toolbar {editor} />
<Editor {editor} />

<!-- Save: -->
<button onclick={() => save(editor.getJSON())}>Save</button>
```

`<Editor>` includes the slash menu (`/`), floating selection menu, and gutter plus/drag handles by default (`slash_menu`/`floating_menu`/`plus_button` props to disable). The `Editor` class is runes-reactive: `editor.doc`, `editor.selection`, `editor.active_marks`, `editor.active_block`, `editor.can_undo`, `editor.is_empty`, `editor.focused`, and `editor.uploads` all work directly in templates.

## Uploads

The editor never talks to a network itself — provide an `Uploader`:

```ts
import { imageURL, toImageProps } from '@delightstack/images';

const uploader: Uploader = {
	async upload(file, { kind, signal, on_progress }) {
		const record = await uploadToImagesBackend(file, { signal, on_progress });
		return {
			image: {
				id: record.id,
				width: record.width,
				height: record.height,
				src: imageURL(record.id),
				srcset: toImageProps(record).srcset,
				thumbhash: record.thumbhash,
			},
		};
	},
};
```

Dropped/pasted files insert an optimistic placeholder node immediately (blob preview + progress); the real attrs swap in when the upload completes. Deleting the placeholder aborts the upload. `getJSON()` strips in-flight placeholders so storage never sees blob URLs.

## Custom blocks

One `defineBlock()` object registers everything — schema, Svelte node view, interactive chrome, settings, and menu entries:

```ts
import { defineBlock } from '@delightstack/editor';

const pricing = defineBlock<{ plan: string }>({
	name: 'pricing_table',
	schema: {
		group: 'block',
		atom: true,
		attrs: { plan: { default: 'pro' } },
		toDOM: (node) => ['div', { 'data-block': 'pricing_table', 'data-plan': node.attrs.plan }],
		parseDOM: [{ tag: 'div[data-block="pricing_table"]' }],
	},
	component: PricingTableBlock, // receives BlockProps: attrs, selected, update_attrs, …
	interactive: { resize: { attr: 'width_pct' } }, // optional magnetic-snap resizing
	settings: [{ attr: 'plan', label: 'Plan', control: 'select', options: [...] }],
	commands: [{ name: 'pricing', label: 'Pricing table', group: 'Embeds', run: (e) => e.insertBlock('pricing_table') }],
	render: (node, ctx) => `<div data-plan="${ctx.esc(node.attrs?.plan)}"></div>`,
});

new Editor({ blocks: [...defaultBlocks(), pricing] });
```

Non-atom blocks mark their editable hole with the `content` attachment: `<div {@attach content}>`.

If you plan to use collaborative editing later, define custom block *schemas* with `defineBlockSchema()` in a file shared with your Worker, and compose UI on the client — `buildSchema()` + `schemaHash()` from `@delightstack/editor/schema` are worker-safe.

## Block IDs

Every block-level node carries a stable `block_id` attr, assigned automatically. It is the anchor
for block references, per-block restore, structural diff, presence focus and comment fallback
anchoring — anything that needs to name a block across edits.

The ids are `generateTimestampID({ length: 12 })`: 8 base62 chars of millisecond timestamp, so they
sort by creation, plus 4 of entropy.

They survive the edits you would expect. Splitting a block leaves the id on the first half and
gives the second a fresh one; joining keeps the first's; duplicating gives the copy a new id and
leaves the original's alone, whichever side of the original the copy lands on.

**Pass `doc_id` if the same app edits more than one document.** A block copied out of another
document must not arrive carrying an id that already names a block there, or two different blocks
answer to one id:

```ts
const editor = new Editor({ doc_id: node.id, content });
```

Copying stamps `<doc_id>:<block_id>` onto the clipboard; pasting keeps the bare id only when the
stamp matches, and clears it otherwise so a fresh one is assigned. An unstamped id — HTML from
another app, or one that happens to write its own `data-block-id` — is never trusted. Without
`doc_id`, each editor instance is treated as its own document, which can only cause regeneration,
never a collision.

## Markdown (`markdown`)

The package ships a small markdown parser for paste and no serializer. That is right for an app
whose documents are ProseMirror JSON and wrong for an app that has a **dialect** — its own
constructs, its own spelling of them, its own round-trip guarantees. The `markdown` option is
where such an app takes over:

```ts
const editor = new Editor({
  markdown: {
    // markdown text → what to insert (ProseMirror JSON). `null` declines.
    parse: (text) => parseMarkdown(text).content,
    // a copied slice → the clipboard's text/plain. `null` declines.
    serialize: (slice) => serializeMarkdown(docFromSlice(slice)),
    // optional: is this plain text markdown at all? Defaults to the built-in heuristic.
    looks_like: (text) => /^#{1,6} |^[-*+] |^> /m.test(text),
  },
});
```

The editor calls them in exactly two places and nowhere else:

- **Paste.** A plain-text paste `looks_like` claims goes through `parse`. The result is run
  through `transformPasted` before it is inserted, exactly as a rich paste is — so the block-id
  rules apply to a markdown paste too, and ids that came off somebody else's clipboard are
  cleared rather than trusted. JSON the schema rejects is a decline, not a throw.
- **Copy and cut.** `serialize` writes the clipboard's `text/plain`. `text/html` is untouched, so
  a paste back into an editor still takes the lossless path — which is also why, when a clipboard
  carries **both** flavours, the HTML one wins.

The slice handed to `serialize` has already been through `transformCopied`, so `<doc_id>:<id>`
stamps are visible there and can be stripped before they leave the app.

Markdown is a clipboard flavour and an import format here, not the document format. An app that
wants a markdown *projection* of a document runs its own serializer over `editor.doc` on its own
schedule; the editor neither knows nor asks.

## Typing shortcuts (`input_rules`)

`# `, `- `, `1. `, `> `, ```` ``` ````, `---`, `**bold**`, `*italic*`, `` `code` `` and
`~~strike~~` are installed by default. `input_rules: false` installs none, and a factory replaces
the list:

```ts
const editor = new Editor({
  // `#` is level 1 in this app's dialect, not the default rule's level 2
  input_rules: ({ schema, defaults }) => [...myDialectRules(schema), ...defaults],
});
```

The order is the semantics: rules run in order and the first that fires wins, so a rule placed
ahead of a built-in **shadows** it. `baseInputRules(schema)` is the same list the factory is
handed, exported for anyone assembling their own. `InputRule`, `textblockTypeInputRule`,
`wrappingInputRule` and `markInputRule` are re-exported so writing a dialect's rules needs no
direct dependency on `prosemirror-inputrules`.

A block's own `input_rules` are unaffected and always additive — they install as their own
plugin, after this one.

`undoInputRule` is re-exported alongside `InputRule`, `inputRules`, `textblockTypeInputRule` and
`wrappingInputRule`. It is the command the package's own `Backspace` is chained from, so a test
that one press undoes a rule you wrote can drive the real command rather than a look-alike.

## Bindings (`keymap`)

The shipped keymap covers marks, headings, list handling, block movement and undo. `keymap` is
the `input_rules` seam for keystrokes: a factory returning bindings that are installed **ahead**
of the package's, so a key named here replaces the shipped one and every key left unnamed keeps
what it ships with.

```ts
import { Editor, toggleBlockType } from '@delightstack/editor';

const editor = new Editor({
  // `Mod-Alt-1` is a level-1 heading in this app's dialect, not the shipped level 2
  keymap: ({ schema }) => ({
    'Mod-Alt-1': toggleBlockType(schema.nodes.heading, { level: 1 }),
  }),
});
```

A block's own `keymap` still binds tighter — a block that owns a key owns it inside itself — and
`Mod-z` belongs to whatever the `history` option installed.

The block commands the shipped keymap binds are exported (`moveBlock`, `duplicateBlock`,
`insertLine`, `deleteLine`, beside `toggleMark`, `toggleBlockType`, `toggleList`, `insertNode`
and `toggleTodoChecked`), because a palette entry has to run the same command the key runs.

`wrapIn` and `lift` are exported beside them. `toggleBlockType` is `setBlockType` underneath, and
`setBlockType` **throws** on a node that is not a textblock — so it is not the toggle for a
blockquote or a callout, and the pair that builds one is `prosemirror-commands`', a library a host
reaches only through this package:

```ts
const quote = (state, dispatch, view) => {
  const { $from } = state.selection;
  const inside = $from.depth > 0 && $from.node($from.depth - 1).type === schema.nodes.blockquote;
  return inside ? lift(state, dispatch, view) : wrapIn(schema.nodes.blockquote)(state, dispatch, view);
};
```

## Trigger menus (`editor.suggest`)

`editor.suggest(trigger, handler, options?)` watches for a trigger string before the cursor and
routes open / update / close / keydown to a handler the app owns. The slash menu is one of these;
so are `@` mentions and `[[` wikilinks.

```ts
const off = editor.suggest('[[', () => handler, { word_start: false });
```

The trigger is a **string, not a character** — `[[` is one trigger, and the range the handler is
handed covers the whole of it plus the query, so accepting a suggestion replaces the brackets
too.

`word_start` (default `true`) is the rule that a trigger must begin a word — the block's first
character, or one after whitespace. It is what keeps a `/` in the middle of a sentence a slash.
Turn it off for a multi-character trigger, which does not get typed by accident and legitimately
follows an opening bracket or a dash.

`allow(state, trigger_pos)` is an extra gate on top (the slash menu uses it to demand an empty
block), and `ctx.dismiss()` closes the menu until the trigger is deleted — the same as Escape.
The plugin stays inert during IME composition and closes if one starts.

No menu opens inside code — a code block, or text carrying a code mark. A menu inserts a node on
accept, and inside a code span that would replace the very text the writer was quoting.

## Server rendering

Public pages shouldn't ship the editor. `@delightstack/editor/render` is a zero-dependency (no svelte, no prosemirror) JSON → HTML walker, safe in Workers:

```ts
import { renderHTML, renderText } from '@delightstack/editor/render';

const html = renderHTML(doc, { image_url: (id) => imageURL(id) });
const searchable = renderText(doc);
```

## Typography (`--editor-*`)

The editor's own type scale is a set of custom properties, so a host that draws the same document
twice — a read-only render before the editor mounts, and the editor after — can declare the type
**once** and have both states agree. Left unset, every one of them is the value the editor used to
hard-code, so nothing changes for a consumer that sets none of them.

Set them on the container the editor mounts inside:

```css
.prose {
	line-height: 1.65;
	--editor-line-height: 1.65;
	--editor-h1-size: 1.6em;
	--editor-quote-border: 2px solid var(--color-border);
}
```

| Property | Default |
|---|---|
| `--editor-line-height` | `1.7` |
| `--editor-heading-line-height` | `1.3` |
| `--editor-heading-weight` | `650` |
| `--editor-heading-letter-spacing` | `-0.015em` |
| `--editor-h1-size` … `--editor-h4-size` | `2em`, `1.5em`, `1.25em`, `1.0625em` |
| `--editor-code-size` | `0.875em` (both `pre` and inline `code`) |
| `--editor-code-bg` | `var(--color-bg-muted)` |
| `--editor-code-radius` | `calc(var(--radius, 8px) / 2)` |
| `--editor-code-padding` | `0.125em 0.375em` |
| `--editor-pre-bg` | `var(--color-bg-muted)` |
| `--editor-pre-border` | `none` |
| `--editor-pre-radius` | `var(--radius, 8px)` |
| `--editor-pre-padding` | `1em 1.25em` |
| `--editor-pre-line-height` | `1.6` |
| `--editor-list-indent` | `1.625em` (`ul` and `ol`) |
| `--editor-quote-border` | `3px solid color-mix(in oklab, var(--color-text, currentColor) 25%, transparent)` |
| `--editor-quote-padding` | `1.25em` |

### Vertical rhythm

The gaps between blocks are the other half of "the same document twice": type that matches at a
gap that does not still moves every line below it.

| Property | Default | Between |
|---|---|---|
| `--editor-block-gap` | `0.875em` | Any two top-level blocks |
| `--editor-heading-gap-before` | `1.9em` | A heading and what came before it |
| `--editor-heading-gap-after` | `0.5em` | A heading and what it introduces |
| `--editor-list-item-gap` | `0.375em` | Two list items |
| `--editor-list-nest-gap` | `0.375em` | An item and a list nested inside it |

`--editor-list-item-gap` and `--editor-list-nest-gap` were one rule and are now two, because a
nested list is a block inside its item rather than another item, and a host may reasonably space
the two differently. Both defaults are what the single rule said.

Why properties rather than "just override the CSS": the editor's rules are written as
`.editor .ProseMirror h1` — three classes — which outranks a host's own container selector wherever
the two stylesheets land in the cascade. A host could only win with `!important` or a deeper
selector into the editor's internals. A custom property has no specificity to fight.

## Manual QA checklist

Things unit tests can't cover — verify in the example app (`/editor`) after meaningful changes:

- [ ] Typing latency feels instant; IME composition (Japanese/Chinese/dead keys) works, and no menu opens mid-composition
- [ ] `/` menu: opens, filters, arrows/Enter/Escape, closes on click-away, doesn't reopen after Escape until retyped
- [ ] Floating menu appears over selections, flips near viewport edges, hides while drag-selecting
- [ ] Gutter plus + drag handle appear on hover; dragging a block shows the drop cursor and FLIP-animates the move
- [ ] Image upload: drop, paste, and `/image` picker; progress ring; delete mid-upload aborts; failure shows the error card
- [ ] Resize grips: magnetic snap engages/releases with the badge label; committed width survives reload
- [ ] Paste: Word/Google Docs formatting survives (headings, bold, lists); a URL over a selection becomes a link; a YouTube URL on an empty line becomes an embed; markdown text pastes rich
- [ ] Settings popover edits apply live and undo as one step
- [ ] Read-only mode hides all chrome; `/editor/rendered` matches the editor's appearance
- [ ] Undo/redo across all of the above behaves sanely

## Splitting and joining documents

`splitAt` and `joinDocuments` are the document-level counterparts of splitting and joining a
block. They are what a "split this scene here" / "merge this into the previous one" gesture is
built from.

```ts
import { joinDocuments, splitAt } from '@delightstack/editor';

// Cut the open document at the caret. `head` stays; `tail` becomes a new document.
const { head, tail } = splitAt(view.state.doc, view.state.selection.from);

// And back again.
const rejoined = joinDocuments(head, tail);
```

Both are **pure**: node in, node out. No `EditorState`, no transaction, no view — deliberately,
because the two halves of a split do not live in the same editor. The head stays where it is and
the tail is written into a document that has no editor open on it at all, which a `Command` could
never have expressed. Applying the result — dispatching the truncation, creating the second
document, writing the tail into it — belongs to the app, which is the only thing that knows what a
document *is* in its model.

`splitAt(doc, pos)` cuts rather than slices, so a position inside a list or a quote gives two
halves that are each still a list or a quote. A cut that lands inside a textblock splits it and
both resulting blocks are complete. A position of `0` or `doc.content.size` gives one empty half
rather than an error: whether an empty half means the gesture should be refused depends on whether
it came from a keystroke or a menu, and only the app knows.

A wrapper the cut emptied is dropped rather than handed back: cutting in the gap before a list's
first item would otherwise leave an empty `bullet_list` on the head side, and a `list_item+` node
with no items is a document the schema refuses. The test is the node's own content expression, so
an empty paragraph — which is legal — stays.

`joinDocuments(a, b, options)` appends `b`'s content to `a`'s and takes `a`'s type and attrs.
`separator` puts blocks between the two — nothing by default, because in a block document the
blocks are already separate; what a scene break or a rule *means* is the app's dialect. Trailing
empty paragraphs are trimmed from `a` first (`trim_trailing_empty: false` keeps them), because a
document being typed into ends in the caret's empty paragraph almost all of the time and that
blank block lands exactly at the seam the reader is looking at.

**Block ids survive both.** `splitAt` leaves every id in the head untouched and regenerates only
those the tail would duplicate — the block the cut ran through — which is the same "first half
keeps it" rule that splitting a paragraph with `Enter` follows. `joinDocuments` leaves `a`'s ids
alone and regenerates only those of `b`'s that `a` already uses. So an id is stable wherever it can
be, and unique afterwards without exception.

## Replacing undo (`history`)

`history` takes `false`, an options object, or a factory. A factory that returns a bare
`Plugin[]` swaps the plugin only; one that returns a `HistoryImplementation` takes over
`Mod-z`/`Mod-y`/`Mod-Shift-z`, `undo()`, `redo()`, `can_undo` and `can_redo` as a set:

```ts
interface HistoryImplementation {
  plugins: Plugin[];
  undo: Command;
  redo: Command;
  canUndo(state: EditorState): boolean;
  canRedo(state: EditorState): boolean;
}
```

They move together on purpose. An editor whose keyboard drives one undo stack while its
toolbar reports another's depth is worse than one with no undo at all.

This is what a CRDT binding needs. With `@delightstack/crdt/prosemirror` the undo stack
belongs to Loro and is scoped to the local peer — `prosemirror-history`'s stack is a list of
steps applied to *this editor*, which includes a collaborator's paragraph and an agent's
rewrite, so `Cmd+Z` would delete someone else's work.

```ts
import { loroPlugins, undo, redo, canUndo, canRedo } from '@delightstack/crdt/prosemirror';

const editor = new Editor({
  doc_id: node_id,
  history: () => ({ plugins: loroPlugins({ crdt: handle }), undo, redo, canUndo, canRedo }),
});
```

## Tracked changes (`suggestionDecorations`)

Renders proposed edits the **host** owns — an agent's rewrite, a collaborator's suggestion, a
linter's fix — as inline tracked changes, without applying any of them.

```ts
import { suggestionDecorations, suggestionCommands } from '@delightstack/editor';

const options = {
  source: () => pending, // or { get(), subscribe(cb) }
  onAccept: (suggestion, { from, to, view }) => applyEdit(suggestion, from, to),
  onReject: (suggestion) => discardRow(suggestion.id),
  onStale: (list) => markStale(list),
};

editor.registerPlugins([suggestionDecorations(options)]);
```

A suggestion is `{ id, find, replace, block_id?, prefix?, suffix?, note?, actor? }` — `find` is the
exact text to be replaced, `replace` the text proposed in its place. Empty `replace` is a deletion;
empty `find` is an insertion, anchored after `prefix` — or before `suffix` when there is no text
before it, or at the front of `block_id` when it has neither.

**The plugin owns none of the data and writes nothing to the document.** It reads the list and
calls back; applying an accepted edit is yours to do, through whatever history you have bound. That
is the property the feature exists for — a proposal is metadata, so the document's history stays
clean until a person says yes.

### How positions are found

By content, on every document change — not by a mapped position.

A proposal is made against text read somewhere else, by something that never had this editor open,
so there was never a position to take: there is only text to find again. Each suggestion is
resolved by looking for `find` inside the block named by `block_id`, falling back to the rest of the
document (a block that was split since is a renumbered block, not a deleted one), and `prefix` /
`suffix` break ties between identical occurrences — partially, so a nearby edit degrades the match
instead of erasing it.

This is also the behaviour you want: edit the paragraph around a suggestion and it follows the
sentence it was about. Delete that sentence and the suggestion has nowhere to go — it is passed to
`onStale` and **never dropped silently**, because the host has a sidebar to show it in and a row to
mark. `resolveSuggestions(doc, list)` is exported if you want the same answer outside a plugin.

Matching tolerates Unicode normalisation: `café` has a composed and a decomposed spelling that are
the same text and not the same string, and a `find` that crossed a process boundary may be spelled
either way. Both are tried against the document's own text, which is never renormalised — the
resolved range is the length of what the document holds, not of the needle.

A resolve stops as soon as the block named by `block_id` answers. A hit there outranks anything the
rest of the document can score, so scanning on would cost every keystroke an
O(suggestions × document) pass that could not change the answer.

The inserted half of a proposal is a **widget**, not an inline decoration. It has to be: the
proposed text is not in the document, so there is no range to decorate. Both widgets set `stopEvent`
and `ignoreSelection` — a widget's DOM sits inside the contenteditable, and the chip holds focusable
buttons, so without that Enter on the accept button also reached the keymap and split the
paragraph.

### Keys

None are bound. A table of editor shortcuts belongs to an app, so the commands are exported and you
bind them:

```ts
const { acceptSuggestion, rejectSuggestion, acceptAllSuggestions, rejectAllSuggestions } =
  suggestionCommands(options);

// plus `nextSuggestion` / `previousSuggestion`, importable directly.
```

The chip's own buttons are real `<button>`s in a `role="group"`, so Enter and Space work on them
already without the package claiming a chord — and `stopEvent` keeps those keys from reaching the
document underneath.

A command with no matching callback bound returns `false`, so the key falls through to whatever you
bound after it instead of being swallowed.

### Styling

Nine custom properties, defaults derived from `--color-success` / `--color-error`:

| Property | Default |
|---|---|
| `--editor-suggestion-insert` | `--color-success` |
| `--editor-suggestion-insert-bg` | the above at 14% alpha |
| `--editor-suggestion-insert-text` | `inherit` |
| `--editor-suggestion-delete` | `--color-error` |
| `--editor-suggestion-delete-bg` | the above at 14% alpha |
| `--editor-suggestion-delete-text` | `inherit` |
| `--editor-suggestion-focus` | `--action` |
| `--editor-suggestion-chip-bg` | `--color-bg-muted` |
| `--editor-suggestion-chip-radius` | `4px` |

Where a token is missing too, the built-in fallback is a `light-dark()` pair rather than one value,
so the properties work on a dark page for a host that has no design tokens at all. Every pair clears
4.4:1 against the chip in both themes.

Colour is never the only signal — the deletion is struck through and the insertion underlined (the
pair `<del>` and `<ins>` have carried since long before either had a colour), and the two chip
buttons are a check and a cross before they are green and red. The struck range also carries
`role="deletion"`, because an inline decoration sets attributes on the text's existing DOM and
cannot make it a `<del>`; the insertion is a real `<ins>` and needs no help.

The chip's `aria-label` names the change by its text — "agent:claude suggests replacing “X” with
“Y”", plus the note — rather than by its machinery. Pass `labels.describe` to write your own.

## Focus mode (`focusDim`)

Dim everything except the unit of text the caret is in — the current `sentence`, `paragraph` or
`block`. Opt-in, decorations only: nothing enters the document, its history, or its serialized
form, because focus mode is a fact about one screen rather than about the document.

```ts
import { focusDim, setFocusDim, focusDimStateOf } from '@delightstack/editor';

const editor = new Editor({
	plugins: () => [focusDim({ unit: 'sentence' })], // off until the host enables it
});

// The host's own toggle (a key, a palette row) — a meta-only transaction:
setFocusDim(view, { enabled: true });
setFocusDim(view, { unit: 'paragraph' });
focusDimStateOf(view.state); // { enabled: true, unit: 'paragraph' }
```

Sentence boundaries come from `Intl.Segmenter` with a best-effort abbreviation merge on top (ICU
would end a sentence after `Dr.`); an environment without the segmenter degrades `sentence` to
`paragraph` rather than throwing. Blocks outside the unit are dimmed with node decorations — one
per subtree, which is what keeps a keystroke in a long document cheap and reaches images and code
blocks — and the text around the caret's sentence with inline decorations.

The package ships **no opacity**. Every decoration carries one class, `ds-focus-dim` (or
`class_name`), and the host styles it against its own theme:

```css
.ProseMirror :is(.ds-focus-dim) {
	opacity: 0.3;
	transition: opacity 200ms;
}
```

No keys are bound; `setFocusDim` is what the host's keymap runs.

## Passive term decoration (`termDecorations`)

Decorate every occurrence of an externally-owned term set — a glossary, a character register, a
linter's word list — *passively*: invisible by default, revealed while the modifier key is held,
activated with a modifier-click. Decorations only, on the same footing as `suggestionDecorations`
and `focusDim`: nothing enters the document, its history, or its serialized form.

The matching itself is a **seam, not a built-in**: the host hands a `match(text)` function and the
plugin owns everything positional. That is deliberate — matching rules (case sensitivity per term,
word boundaries beyond ASCII, possessives) are the host's dialect, and a host with a server-side
matcher must decorate with the same code, not with this package's opinion of it. A `RegExp` over a
short list is a perfectly good `match` for a glossary.

```ts
import { termDecorations, setTermDecorations } from '@delightstack/editor';

const editor = new Editor({
	plugins: () => [
		termDecorations({
			match: (text) => findMyTerms(text), // offsets into `text`, [{ term_id, from, to }]
			onActivate: (term_id) => openGlossary(term_id), // modifier-click
		}),
	],
});

// The term set changed — re-match the whole document once:
setTermDecorations(view, { refresh: true });
// A host setting like “always highlight”:
setTermDecorations(view, { always_on: true });
```

Each textblock hands `match` one string whose index `i` is exactly the ProseMirror position
`block_start + 1 + i`: text nodes contribute their characters, every other inline child
contributes U+FFFC per position, and text under a skipped mark (inline `code` by default) is
masked to spaces of the same length. Code blocks are skipped entirely. Offsets come back, get
spent as positions verbatim, and only the textblocks a transaction touched are re-matched —
everything else is mapped.

The package ships **no styles**. Every decoration carries `ds-term` (or `class_name`) plus
`data-term-id`; the editor root carries `ds-terms-reveal` while the modifier is held and
`ds-terms-always` while `always_on` is set. The host's CSS decides what a revealed term looks
like:

```css
.ProseMirror:is(.ds-terms-reveal, .ds-terms-always) .ds-term {
	text-decoration: underline dotted;
	cursor: pointer;
}
```

## Roadmap (designed, not yet built)

Collaboration (prosemirror-collab + Durable Object authority over `@delightstack/websocket`), presence cursors (`@delightstack/presence`), comments (`@delightstack/database`), version history / time travel, AI suggestions (`@delightstack/ai`), `@` mentions, and layout/columns blocks. The core ships the seams these need: isomorphic schema + `schemaHash`, injectable history, a wrappable dispatch funnel, stable `block_id` attrs, the generic trigger-menu plugin, multi-source decorations, read-only state swap, and `EditorTransport`.
