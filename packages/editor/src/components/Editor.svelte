<script lang="ts">
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
</script>

<div class="editor {class_name}" class:readonly {id} bind:this={container}>
	{#if !mounted}
		<div class="content ssr">{@html ssr_html}</div>
	{/if}
	<div class="content" {@attach attach}></div>
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
		line-height: 1.6;
	}

	.ssr {
		padding-block: var(--space-1, 0.5rem);
	}

	.editor :global {
		.ProseMirror {
			outline: none;
			white-space: pre-wrap;
			word-wrap: break-word;
			padding-block: var(--space-1, 0.5rem);

			> * + * {
				margin-block-start: 0.625em;
			}

			h1,
			h2,
			h3,
			h4,
			h5,
			h6 {
				line-height: 1.25;
				font-weight: 650;
				text-wrap: balance;

				&:not(:first-child) {
					margin-block-start: 1.25em;
				}
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
				font-size: 1.125em;
			}

			blockquote {
				margin-inline: 0;
				padding-inline-start: 1em;
				border-inline-start: 3px solid var(--color-border, currentColor);
				color: var(--color-text-muted, inherit);
			}

			pre {
				background: var(--color-bg-muted);
				border-radius: var(--radius, 8px);
				padding: 0.75em 1em;
				overflow-x: auto;
				font-size: 0.875em;
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

			ul,
			ol {
				padding-inline-start: 1.5em;
			}

			li p {
				margin: 0;
			}

			li + li {
				margin-block-start: 0.25em;
			}

			ul[data-todo-list] {
				list-style: none;
				padding-inline-start: 0.25em;
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
				border-block-start: 2px solid var(--color-border, currentColor);
				margin-block: 1.5em;
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
