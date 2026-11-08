<script lang="ts">
	import { TextSelection } from 'prosemirror-state';
	import { Button } from '@delightstack/components';
	// Aliased so the generated .d.ts doesn't declare `Editor` twice (the
	// component itself is emitted as `Editor`, which would shadow the value
	// export into a type-only declaration for consumers).
	import type { Editor as EditorInstance } from '../core/editor.svelte.js';
	import { svelteNodeViews } from '../core/node-view/svelte-node-view.svelte.js';
	import { renderHTML } from '../render/index.js';
	import SlashMenu from './SlashMenu.svelte';
	import FloatingMenu from './FloatingMenu.svelte';
	import BlockGutter from './BlockGutter.svelte';
	import MobileBar from './MobileBar.svelte';

	interface Props {
		editor: EditorInstance;
		/** Forces read-only display mode (menus and chrome hidden) */
		readonly?: boolean;
		/** Show the '/' command menu. Default true */
		slash_menu?: boolean;
		/** Show the floating selection menu. Default true */
		floating_menu?: boolean;
		/** Show the gutter plus button. Default true */
		plus_button?: boolean;
		/** Fixed bottom formatting bar on small viewports. Default true */
		mobile_toolbar?: boolean;
		class?: string;
		id?: string;
	}

	let {
		editor,
		readonly = false,
		slash_menu = true,
		floating_menu = true,
		plus_button = true,
		mobile_toolbar = true,
		class: class_name = '',
		id = undefined,
	}: Props = $props();

	let container = $state<HTMLElement | null>(null);
	let mounted = $state(false);

	$effect(() => {
		editor.editable = !readonly;
	});

	// Server-render the document so content paints before ProseMirror
	// hydrates (no layout shift); the preview is removed once the live view
	// mounts.
	const ssr_html = $derived.by(() => {
		if (mounted) return '';
		const blocks: Record<string, import('../types/index.js').BlockRenderer> = {};
		for (const [name, block] of editor.blocks) {
			if (block.render) blocks[name] = block.render;
		}
		return renderHTML(editor.doc, { blocks });
	});

	function attach(el: HTMLElement) {
		editor.setNodeViews(svelteNodeViews(editor));
		editor.mount(el);
		mounted = true;
		return () => {
			editor.unmount();
			mounted = false;
		};
	}

	// Screen-reader announcements for spatial operations that are otherwise
	// silent (block moves via drag, keyboard, or the gutter menu)
	let announcement = $state('');
	let announce_timeout: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const off = editor.on('transaction', (_editor, tr) => {
			if (!tr?.docChanged || tr.getMeta('uiEvent') !== 'drop') return;
			// Clear first so repeating the same message still announces
			announcement = '';
			clearTimeout(announce_timeout);
			announce_timeout = setTimeout(() => (announcement = 'Block moved'), 30);
		});
		return () => {
			off();
			clearTimeout(announce_timeout);
		};
	});

	// Clicking the empty runway below the last block (hosts often give the
	// editor extra min-height) lands the caret at the end of the document —
	// appending a fresh paragraph when the doc ends in an atom (image,
	// divider) so there's always somewhere to type.
	function clickBelowContent(event: MouseEvent) {
		if (readonly || !mounted) return;
		const view = editor.view;
		if (!view) return;
		// Only bare-container clicks: clicks on content already place the caret
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (target !== container && !target.classList.contains('content')) return;
		if (event.clientY <= view.dom.getBoundingClientRect().bottom) return;
		const doc = editor.state.doc;
		let tr = editor.state.tr;
		const last = doc.lastChild;
		if (!last || !last.isTextblock || last.type.spec.code) {
			tr = tr.insert(doc.content.size, editor.schema.nodes.paragraph.create());
		}
		tr = tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size), -1));
		editor.dispatch(tr.scrollIntoView());
		editor.focus();
	}

	// Quick-start chips shown under the placeholder while the doc is empty
	const QUICK_STARTERS = ['heading_2', 'bullet_list', 'image', 'gallery'] as const;
	const quick_chips = $derived.by(() => {
		if (!mounted || readonly || !editor.is_empty || !editor.editable) return [];
		return QUICK_STARTERS.map((name) => editor.commands.get(name)).filter(
			(command) => command && (!command.is_enabled || command.is_enabled(editor)),
		) as NonNullable<ReturnType<typeof editor.commands.get>>[];
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="editor {class_name}"
	class:readonly
	{id}
	onclick={clickBelowContent}
	bind:this={container}>
	{#if !mounted}
		<div class="content ssr">{@html ssr_html}</div>
	{/if}
	<div class="content" {@attach attach}></div>
	{#if quick_chips.length}
		<div class="quick-chips" contenteditable="false">
			{#each quick_chips as command (command.name)}
				<Button
					dense
					outline
					size="0"
					onpointerdown={(event: PointerEvent) => {
						if (event.button !== 0) return;
						event.preventDefault();
						editor.focus();
						command.run(editor);
					}}>
					<span class="chip-icon">
						{#if typeof command.icon === 'string'}{@html command.icon}{/if}
					</span>
					{command.label}
				</Button>
			{/each}
		</div>
	{/if}
	<div class="sr-announce" role="status" aria-live="polite">{announcement}</div>
	{#if !readonly}
		{#if slash_menu}
			<SlashMenu {editor} />
		{/if}
		{#if floating_menu}
			<FloatingMenu {editor} />
		{/if}
		{#if plus_button && container}
			<BlockGutter {editor} {container} />
		{/if}
		{#if mobile_toolbar}
			<MobileBar {editor} />
		{/if}
	{/if}
</div>

<style>
	.editor {
		position: relative;
		color: var(--color-text);
		line-height: var(--editor-line-height, 1.7);
	}

	.ssr {
		padding-block: var(--space-1, 0.5rem);
	}

	.sr-announce {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.quick-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding-block: 0.25rem 0.5rem;
		color: var(--color-text-muted);
		opacity: 0;
		animation: ds-editor-chips-in 240ms var(--ease-out, ease) 200ms forwards;
	}

	.chip-icon {
		display: inline-grid;
		place-items: center;
		inline-size: 1em;
		block-size: 1em;
		margin-inline-end: 0.375rem;

		:global(svg) {
			inline-size: 100%;
			block-size: 100%;
		}
	}

	@keyframes -global-ds-editor-chips-in {
		from {
			translate: 0 4px;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}

	.editor :global {
		.ProseMirror {
			outline: none;
			white-space: pre-wrap;
			word-wrap: break-word;
			padding-block: var(--space-1, 0.5rem);

			/* Node views are regular Svelte component markup — the formatter's
			   whitespace between their elements must not render as blank lines
			   under pre-wrap. Only the editable content holes keep it. */
			.ds-block {
				white-space: normal;
			}

			[data-editor-content] {
				white-space: pre-wrap;
			}

			/* ---- vertical rhythm (Medium-style: generous, deliberate) ---- */

			> * {
				margin-block: 0;
			}

			> * + * {
				margin-block-start: var(--editor-block-gap, 0.875em);
			}

			/* Headings open a new section: lots of air above… */
			> h1:not(:first-child),
			> h2:not(:first-child),
			> h3:not(:first-child),
			> h4:not(:first-child),
			> h5:not(:first-child),
			> h6:not(:first-child) {
				margin-block-start: var(--editor-heading-gap-before, 1.9em);
			}

			/* …and hug the content they introduce (placed after the rhythm
			   rule so it wins the tie) */
			> h1 + *,
			> h2 + *,
			> h3 + *,
			> h4 + *,
			> h5 + *,
			> h6 + * {
				margin-block-start: var(--editor-heading-gap-after, 0.5em);
			}

			/* Media and rich blocks get breathing room on both sides */
			> .ds-block:not(:first-child),
			> .ds-block + * {
				margin-block-start: 1.5em;
			}

			> hr:not(:first-child),
			> hr + * {
				margin-block-start: 2.25em;
			}

			/* ---- headings ---- */

			h1,
			h2,
			h3,
			h4,
			h5,
			h6 {
				line-height: var(--editor-heading-line-height, 1.3);
				font-weight: var(--editor-heading-weight, 650);
				letter-spacing: var(--editor-heading-letter-spacing, -0.015em);
				text-wrap: balance;
			}

			h1 {
				font-size: var(--editor-h1-size, 2em);
			}
			h2 {
				font-size: var(--editor-h2-size, 1.5em);
			}
			h3 {
				font-size: var(--editor-h3-size, 1.25em);
			}
			h4 {
				font-size: var(--editor-h4-size, 1.0625em);
			}

			blockquote {
				margin-inline: 0;
				padding-inline-start: var(--editor-quote-padding, 1.25em);
				border-inline-start: var(
					--editor-quote-border,
					3px solid color-mix(in oklab, var(--color-text, currentColor) 25%, transparent)
				);
				color: var(--color-text-muted, inherit);

				> * + * {
					margin-block-start: 0.5em;
				}
			}

			pre {
				background: var(--editor-pre-bg, var(--color-bg-muted));
				border: var(--editor-pre-border, none);
				border-radius: var(--editor-pre-radius, var(--radius, 8px));
				padding: var(--editor-pre-padding, 1em 1.25em);
				overflow-x: auto;
				font-size: var(--editor-code-size, 0.875em);
				line-height: var(--editor-pre-line-height, 1.6);
				tab-size: 2;

				@supports (corner-shape: squircle) {
					corner-shape: squircle;
					border-radius: calc(
						var(--editor-pre-radius, var(--radius, 8px)) * var(--squircle-ratio, 2)
					);
				}
			}

			code {
				font-family: var(--font-mono, ui-monospace, monospace);
			}

			:not(pre) > code {
				background: var(--editor-code-bg, var(--color-bg-muted));
				border-radius: var(--editor-code-radius, calc(var(--radius, 8px) / 2));
				padding: var(--editor-code-padding, 0.125em 0.375em);
				font-size: var(--editor-code-size, 0.875em);
			}

			/* ---- lists ---- */

			ul,
			ol {
				padding-inline-start: var(--editor-list-indent, 1.625em);
			}

			li::marker {
				color: var(
					--color-text-muted,
					color-mix(in oklab, currentColor 55%, transparent)
				);
			}

			li p {
				margin: 0;
			}

			li + li {
				margin-block-start: var(--editor-list-item-gap, 0.375em);
			}

			/* A nested list is a block inside its item, not another item, so a
			   host that spaces the two differently needs two properties. Both
			   default to what the one rule they replaced said. */
			li > ul,
			li > ol {
				margin-block-start: var(--editor-list-nest-gap, 0.375em);
			}

			ul[data-todo-list] {
				list-style: none;
				padding-inline-start: 0;

				li + li {
					margin-block-start: 0.5em;
				}
			}

			li[data-todo] {
				display: flex;
				gap: 0.5em;
				align-items: baseline;

				&::before {
					content: '';
					flex: 0 0 auto;
					inline-size: 1.05em;
					block-size: 1.05em;
					translate: 0 0.17em;
					border: 1.5px solid var(--color-border, currentColor);
					border-radius: calc(var(--radius, 8px) / 2);
					cursor: pointer;
					/* Governs UNchecking — settle back gently */
					transition:
						background-color var(--duration-normal, 200ms) var(--ease-out, ease),
						border-color var(--duration-normal, 200ms) var(--ease-out, ease);
				}
			}

			li[data-todo='checked'] {
				&::before {
					background-color: var(--action, var(--color-primary));
					border-color: var(--action, var(--color-primary));
					background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' d='M3.5 8.5l3 3 6-7'/%3E%3C/svg%3E");
					background-size: 80%;
					background-position: center;
					background-repeat: no-repeat;
					/* Checking snaps in — the reward is instant */
					transition: none;
				}

				/* One-shot spring pop added by the todo plugin at toggle time
				   (a class, not state, so loads/undo never replay it) */
				&.ds-todo-pop::before {
					animation: ds-editor-check-pop 300ms
						var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
				}

				> p {
					color: var(--color-text-muted, inherit);
					text-decoration: line-through;
					text-decoration-color: color-mix(in oklab, currentColor 50%, transparent);
				}
			}

			hr {
				border: none;
				border-block-start: 2px solid
					var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
				inline-size: 100%;
			}

			a {
				color: var(--action, var(--color-primary));
				text-decoration: underline;
				text-decoration-color: color-mix(in oklab, currentColor 40%, transparent);
				text-underline-offset: 0.15em;
			}

			.is-empty::before {
				content: attr(data-placeholder);
				position: absolute;
				color: var(
					--color-text-disabled,
					color-mix(in oklab, currentColor 35%, transparent)
				);
				pointer-events: none;
				/* Symmetric fade: appearing instantly while disappearing eased
				   reads as two different systems */
				transition: opacity var(--duration-normal, 200ms) var(--ease-out, ease) 100ms;
			}

			.is-focused-empty::before {
				opacity: 0;
			}
		}

		/* Every block carries a transparent outline so selection can EASE both
		   ways: the selected rule below only changes the color */
		.ProseMirror > * {
			outline: 2px solid transparent;
			outline-offset: 2px;
			transition: outline-color var(--duration-normal, 200ms) var(--ease-out, ease);
		}

		.ProseMirror-selectednode {
			outline-color: var(--action, var(--color-primary));
			border-radius: calc(var(--radius, 8px) / 2);
			/* Snap in (instant acknowledgement), ease out via the base rule */
			transition: outline-color 80ms var(--ease-out, ease);
		}

		.ds-dropcursor {
			background: var(--action, var(--color-primary));
			border-radius: 1px;
			box-shadow: 0 0 6px
				color-mix(in oklab, var(--action, var(--color-primary)) 60%, transparent);

			/* Gated on visibility so the pulse's opacity never fights the
			   indicator's own inline fade-out */
			&[data-visible='true'] {
				animation: ds-editor-drop-pulse 900ms var(--ease-in-out, ease-in-out) infinite
					alternate;
			}
		}

		/* Selection tint matches the action color instead of UA default blue */
		.ProseMirror ::selection {
			background: color-mix(
				in oklab,
				var(--action, var(--color-primary)) 25%,
				transparent
			);
		}

		.ProseMirror-gapcursor {
			display: none;
			pointer-events: none;
			position: absolute;

			&::after {
				content: '';
				display: block;
				position: absolute;
				top: -2px;
				width: 20px;
				border-top: 1px solid var(--color-text);
				animation: ds-editor-blink 1.1s steps(2, start) infinite;
			}
		}

		.ProseMirror-focused .ProseMirror-gapcursor {
			display: block;
		}

		/* ---- tracked changes (ED-08) ----
		   Every default is a `--editor-suggestion-*` property, so a host that
		   already has an insertion green and a deletion red — a diff viewer, say —
		   hands them over instead of matching them by eye.

		   **Colour is never the only signal.** The deletion is struck through and
		   the insertion underlined, which is the pair `<del>`/`<ins>` have carried
		   since long before either had a colour, and the two chip buttons are a
		   check and a cross before they are green and red. */

		/* The two colours resolved once, so the `--editor-suggestion-* → token →
		   built-in` chain is written a single time instead of at each of the six
		   places that used to repeat it verbatim.

		   The built-in end of the chain is `light-dark()` rather than one value,
		   which matters for the host these fallbacks exist *for* — one with no
		   design tokens of its own. The old single value was tuned for a white
		   page: on a dark one the chip was a near-white block, and the teal
		   insertion measured 2.9:1 on white, under the 3:1 a glyph needs and well
		   under the 4.5:1 it needs as the button's own colour. Both pairs below
		   clear 4.4:1 against the chip in both themes. A host that never sets
		   `color-scheme` still gets the light half, which is what it got before. */
		.ProseMirror {
			--tracked-insert: var(
				--editor-suggestion-insert,
				var(--color-success, light-dark(oklch(0.52 0.13 158), oklch(0.78 0.15 158)))
			);
			--tracked-delete: var(
				--editor-suggestion-delete,
				var(--color-error, light-dark(oklch(0.52 0.2 25), oklch(0.72 0.17 25)))
			);
			--tracked-insert-bg: var(
				--editor-suggestion-insert-bg,
				oklch(from var(--tracked-insert) l c h / 0.14)
			);
			--tracked-delete-bg: var(
				--editor-suggestion-delete-bg,
				oklch(from var(--tracked-delete) l c h / 0.14)
			);
			--tracked-focus: var(--editor-suggestion-focus, var(--action, var(--color-primary)));
		}
		.ds-suggestion-del {
			background: var(--tracked-delete-bg);
			color: var(--editor-suggestion-delete-text, inherit);
			text-decoration-line: line-through;
			text-decoration-color: var(--tracked-delete);
			text-decoration-thickness: 0.09em;
		}

		ins.ds-suggestion-ins {
			background: var(--tracked-insert-bg);
			color: var(--editor-suggestion-insert-text, inherit);
			text-decoration-line: underline;
			text-decoration-color: var(--tracked-insert);
			text-decoration-thickness: 0.09em;
			text-underline-offset: 0.18em;
		}

		.ds-suggestion-focused {
			outline: 2px solid var(--tracked-focus);
			outline-offset: 1px;
		}

		.ds-suggestion-chip {
			--chip-gap: var(--editor-suggestion-chip-gap, 2px);
			--chip-radius: var(--editor-suggestion-chip-radius, 4px);
			display: inline-flex;
			gap: var(--chip-gap);
			/* Concentric with the buttons inside it: the padding is the gap, so
			   the outer radius is the inner one plus that gap. */
			padding: var(--chip-gap);
			margin-inline-start: 0.25em;
			border-radius: calc(var(--chip-radius) + var(--chip-gap));
			background: var(
				--editor-suggestion-chip-bg,
				var(--color-bg-muted, light-dark(oklch(0.95 0 0), oklch(0.28 0 0)))
			);
			vertical-align: baseline;
			user-select: none;

			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc((var(--chip-radius) + var(--chip-gap)) * 2);
			}
		}

		.ds-suggestion-chip button {
			position: relative;
			display: grid;
			place-items: center;
			min-width: 1.1em;
			height: 1.1em;
			padding: 0 0.25em;
			border: 0;
			border-radius: var(--chip-radius);
			background: transparent;
			color: var(--color-text-muted, inherit);
			font: inherit;
			font-size: 0.75em;
			line-height: 1;
			cursor: pointer;
			/* Colours transition on the base rule so they fade *out*; `:hover`
			   drops them from the list so they snap *in*. */
			transition:
				background-color 300ms,
				color 300ms,
				translate 200ms ease,
				scale 200ms ease;

			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--chip-radius) * 2);
			}

			/* The visual is tiny; the target is not. */
			&::before {
				content: '';
				position: absolute;
				inset: -6px;
			}
		}

		.ds-suggestion-chip button:hover {
			transition:
				translate 200ms ease,
				scale 200ms ease;
		}

		.ds-suggestion-chip button:focus-visible {
			outline: 2px solid var(--tracked-focus);
			outline-offset: 1px;
		}

		.ds-suggestion-chip button:active {
			translate: 0 1px;
			scale: 0.92;
		}

		.ds-suggestion-chip .ds-suggestion-accept:hover,
		.ds-suggestion-chip .ds-suggestion-accept:focus-visible {
			background: var(--tracked-insert-bg);
			color: var(--tracked-insert);
		}

		.ds-suggestion-chip .ds-suggestion-reject:hover,
		.ds-suggestion-chip .ds-suggestion-reject:focus-visible {
			background: var(--tracked-delete-bg);
			color: var(--tracked-delete);
		}

		/* ---- annotations (ED-06) ----
		   Highlights and notes the host owns. Every colour is an
		   `--editor-annotation-*` property, because the palette belongs to the
		   host: DelightWrite fixes five and checks them against four themes, and
		   a glossary tool might have three. The defaults below exist so a
		   consumer that sets nothing still gets a highlighter rather than an
		   invisible decoration.

		   **A wash, not a slab.** The alpha is under 1 on purpose: the text keeps
		   its own colour instead of sitting on a block, and two highlights over
		   one phrase compound into a visibly deeper colour, which is the honest
		   rendering of two highlights over one phrase.

		   **Light and dark are different pigments, not one at two alphas.** A
		   pale yellow over a near-black page is a bright bar that inverts the
		   page in five places and pulls the eye to whatever was marked rather
		   than to what is being read. Same hue, much darker, much less chroma —
		   which is what a highlighter looks like on dark paper. */
		.ProseMirror {
			--annotation-alpha: var(--editor-annotation-alpha, 0.72);
			--annotation-yellow: var(
				--editor-annotation-yellow,
				light-dark(oklch(0.9 0.15 95), oklch(0.42 0.08 92))
			);
			--annotation-green: var(
				--editor-annotation-green,
				light-dark(oklch(0.89 0.14 148), oklch(0.4 0.07 150))
			);
			--annotation-blue: var(
				--editor-annotation-blue,
				light-dark(oklch(0.88 0.11 235), oklch(0.4 0.08 245))
			);
			--annotation-pink: var(
				--editor-annotation-pink,
				light-dark(oklch(0.88 0.1 5), oklch(0.4 0.08 5))
			);
			--annotation-purple: var(
				--editor-annotation-purple,
				light-dark(oklch(0.88 0.1 305), oklch(0.4 0.08 300))
			);
			--annotation-focus: var(
				--editor-annotation-focus,
				var(--action, var(--color-primary))
			);
		}

		.ds-annotation {
			/* The fallback is the yellow, not `transparent`: an annotation whose
			   colour the host did not recognise is still an annotation, and a
			   highlight nobody can see is worse than one in the wrong colour. */
			--annotation-wash: var(--annotation-yellow);
			background: oklch(from var(--annotation-wash) l c h / var(--annotation-alpha));
			/* Rounded, and the rounding is why `box-decoration-break` is here: a
			   highlight that wraps across two lines is one decoration and would
			   otherwise be drawn as one long box with a corner at each far end. */
			border-radius: 0.15em;
			box-decoration-break: clone;
			-webkit-box-decoration-break: clone;
			/* The pointer says the highlight answers to a click, which it does. */
			cursor: pointer;
		}

		.ds-annotation-yellow {
			--annotation-wash: var(--annotation-yellow);
		}
		.ds-annotation-green {
			--annotation-wash: var(--annotation-green);
		}
		.ds-annotation-blue {
			--annotation-wash: var(--annotation-blue);
		}
		.ds-annotation-pink {
			--annotation-wash: var(--annotation-pink);
		}
		.ds-annotation-purple {
			--annotation-wash: var(--annotation-purple);
		}

		.ds-annotation-focused {
			outline: 2px solid var(--annotation-focus);
			outline-offset: 1px;
		}

		/* The note glyph. Small, and its hit target is not: the `::before` grows
		   it to ~24px without moving a pixel of the line it sits in. */
		.ds-annotation-note {
			position: relative;
			display: inline-flex;
			align-items: center;
			margin-inline-start: 0.15em;
			padding: 0;
			border: 0;
			background: none;
			color: var(--color-text-muted, currentColor);
			font: inherit;
			font-size: 0.7em;
			line-height: 1;
			vertical-align: super;
			cursor: pointer;
			user-select: none;
			/* Colours transition on the base rule so they fade *out*; `:hover`
			   drops them from the list so they snap *in*. */
			transition:
				color 300ms,
				scale 200ms var(--ease-out, cubic-bezier(0.25, 1, 0.5, 1));

			&::before {
				content: '';
				position: absolute;
				inset: -8px -4px;
			}

			&:hover {
				color: var(--color-text, currentColor);
				transition: scale 200ms var(--ease-out, cubic-bezier(0.25, 1, 0.5, 1));
			}

			&:focus-visible {
				outline: 2px solid var(--annotation-focus);
				outline-offset: 2px;
				border-radius: 2px;
			}

			&:active {
				scale: 0.88;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.ds-annotation-note {
				transition: color 300ms;
			}

			.ds-annotation-note:active {
				scale: none;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.ds-suggestion-chip button {
				transition:
					background-color 300ms,
					color 300ms;
			}

			.ds-suggestion-chip button:active {
				translate: none;
				scale: none;
			}
		}
	}

	.editor:focus-within :global(.is-focused-empty::before) {
		opacity: 1;
	}

	.editor.readonly :global(.is-empty::before) {
		content: none;
	}

	@keyframes -global-ds-editor-blink {
		to {
			visibility: hidden;
		}
	}

	@keyframes -global-ds-editor-drop-pulse {
		from {
			opacity: 1;
		}
		to {
			opacity: 0.6;
		}
	}

	/* Editor-owned animations respect reduced motion (the floating surfaces
	   gate theirs in JS — see motion.ts) */
	@media (prefers-reduced-motion: reduce) {
		.editor :global(*),
		.editor :global(*::before),
		.editor :global(*::after) {
			animation-duration: 0.01ms !important;
			transition-duration: 0.01ms !important;
		}
	}

	@keyframes -global-ds-editor-check-pop {
		0% {
			scale: 0.8;
		}
		55% {
			scale: 1.12;
		}
		100% {
			scale: 1;
		}
	}
</style>
