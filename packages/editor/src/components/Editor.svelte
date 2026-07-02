<script lang="ts">
	import { Button } from '@delightstack/components';
	import type { Editor } from '../core/editor.svelte.js';
	import { svelteNodeViews } from '../core/node-view/svelte-node-view.svelte.js';
	import { renderHTML } from '../render/index.js';
	import SlashMenu from './SlashMenu.svelte';
	import FloatingMenu from './FloatingMenu.svelte';
	import BlockGutter from './BlockGutter.svelte';

	interface Props {
		editor: Editor;
		/** Forces read-only display mode (menus and chrome hidden) */
		readonly?: boolean;
		/** Show the '/' command menu. Default true */
		slash_menu?: boolean;
		/** Show the floating selection menu. Default true */
		floating_menu?: boolean;
		/** Show the gutter plus button. Default true */
		plus_button?: boolean;
		class?: string;
		id?: string;
	}

	let {
		editor,
		readonly = false,
		slash_menu = true,
		floating_menu = true,
		plus_button = true,
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

	// Quick-start chips shown under the placeholder while the doc is empty
	const QUICK_STARTERS = ['heading_2', 'bullet_list', 'image', 'gallery'] as const;
	const quick_chips = $derived.by(() => {
		if (!mounted || readonly || !editor.is_empty || !editor.editable) return [];
		return QUICK_STARTERS.map((name) => editor.commands.get(name)).filter(
			(command) => command && (!command.is_enabled || command.is_enabled(editor)),
		) as NonNullable<ReturnType<typeof editor.commands.get>>[];
	});
</script>

<div class="editor {class_name}" class:readonly {id} bind:this={container}>
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

	.quick-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding-block: 0.25rem 0.5rem;
		color: var(--color-text-muted);
		opacity: 0;
		animation: ds-editor-chips-in 300ms ease 500ms forwards;
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
		to {
			opacity: 1;
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
				margin-block-start: 0.875em;
			}

			/* Headings open a new section: lots of air above… */
			> h1:not(:first-child),
			> h2:not(:first-child),
			> h3:not(:first-child),
			> h4:not(:first-child),
			> h5:not(:first-child),
			> h6:not(:first-child) {
				margin-block-start: 1.9em;
			}

			/* …and hug the content they introduce (placed after the rhythm
			   rule so it wins the tie) */
			> h1 + *,
			> h2 + *,
			> h3 + *,
			> h4 + *,
			> h5 + *,
			> h6 + * {
				margin-block-start: 0.5em;
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
				line-height: 1.3;
				font-weight: 650;
				letter-spacing: -0.015em;
				text-wrap: balance;
			}

			h1 {
				font-size: 2em;
			}
			h2 {
				font-size: 1.5em;
			}
			h3 {
				font-size: 1.25em;
			}
			h4 {
				font-size: 1.0625em;
			}

			blockquote {
				margin-inline: 0;
				padding-inline-start: 1.25em;
				border-inline-start: 3px solid
					color-mix(in oklab, var(--color-text, currentColor) 25%, transparent);
				color: var(--color-text-muted, inherit);

				> * + * {
					margin-block-start: 0.5em;
				}
			}

			pre {
				background: var(--color-bg-muted);
				border-radius: var(--radius, 8px);
				padding: 1em 1.25em;
				overflow-x: auto;
				font-size: 0.875em;
				line-height: 1.6;
				tab-size: 2;

				@supports (corner-shape: squircle) {
					corner-shape: squircle;
					border-radius: calc(var(--radius, 8px) * var(--squircle-ratio, 2));
				}
			}

			code {
				font-family: var(--font-mono, ui-monospace, monospace);
			}

			:not(pre) > code {
				background: var(--color-bg-muted);
				border-radius: calc(var(--radius, 8px) / 2);
				padding: 0.125em 0.375em;
				font-size: 0.875em;
			}

			/* ---- lists ---- */

			ul,
			ol {
				padding-inline-start: 1.625em;
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

			li + li,
			li > ul,
			li > ol {
				margin-block-start: 0.375em;
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
					transition:
						background-color 300ms ease,
						border-color 300ms ease;
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
					transition: none;
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
			}

			.is-focused-empty::before {
				opacity: 0;
				transition: opacity 300ms ease 150ms;
			}
		}

		.ProseMirror-selectednode {
			outline: 2px solid var(--action, var(--color-primary));
			outline-offset: 2px;
			border-radius: calc(var(--radius, 8px) / 2);
		}

		.ds-dropcursor {
			background: var(--action, var(--color-primary)) !important;
			border-radius: 1px;
			box-shadow: 0 0 6px
				color-mix(in oklab, var(--action, var(--color-primary)) 60%, transparent);
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
</style>
