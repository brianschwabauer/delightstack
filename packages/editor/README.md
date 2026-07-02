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

## Server rendering

Public pages shouldn't ship the editor. `@delightstack/editor/render` is a zero-dependency (no svelte, no prosemirror) JSON → HTML walker, safe in Workers:

```ts
import { renderHTML, renderText } from '@delightstack/editor/render';

const html = renderHTML(doc, { image_url: (id) => imageURL(id) });
const searchable = renderText(doc);
```

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

## Roadmap (designed, not yet built)

Collaboration (prosemirror-collab + Durable Object authority over `@delightstack/websocket`), presence cursors (`@delightstack/presence`), comments (`@delightstack/database`), version history / time travel, AI suggestions (`@delightstack/ai`), `@` mentions, and layout/columns blocks. The core ships the seams these need: isomorphic schema + `schemaHash`, injectable history, a wrappable dispatch funnel, stable `block_id` attrs, the generic trigger-menu plugin, multi-source decorations, read-only state swap, and `EditorTransport`.
