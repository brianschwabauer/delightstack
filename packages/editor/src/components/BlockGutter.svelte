<script lang="ts">
	import { TextSelection } from 'prosemirror-state';
	import { DOMSerializer } from 'prosemirror-model';
	import { Button } from '@delightstack/components';
	import type { Editor } from '../core/editor.svelte.js';
	import type { EditorCommand } from '../types/index.js';
	import { icons } from '../core/icons.js';
	import { portal } from './portal.js';
	import CommandMenu from './CommandMenu.svelte';

	interface Props {
		editor: Editor;
		/** The editor wrapper element the gutter positions against */
		container: HTMLElement;
	}

	let { editor, container }: Props = $props();

	interface HoveredBlock {
		pos: number;
		name: string;
		block_id: string | null;
		rect: DOMRect;
	}

	/** Block types the "Turn into" section applies to */
	const CONVERTIBLE = new Set([
		'paragraph',
		'heading',
		'bullet_list',
		'ordered_list',
		'todo_list',
		'blockquote',
		'code_block',
	]);

	const GUTTER_WIDTH = 56; // 3.5rem strip left of the content

	let hovered = $state<HoveredBlock | null>(null);
	let hovered_empty = $state(false);
	let menu_open = $state<false | 'insert' | 'actions'>(false);
	let menu_block = $state<HoveredBlock | null>(null);
	let selected = $state(0);
	let gutter_el = $state<HTMLElement | null>(null);
	let menu_el = $state<HTMLElement | null>(null);

	const enabled = (command: EditorCommand) =>
		!command.is_enabled || command.is_enabled(editor);

	const items = $derived.by(() => {
		if (menu_open === 'insert') {
			return editor.commands.forSurface('plus').filter(enabled);
		}
		if (menu_open === 'actions' && menu_block) {
			const turn_into = CONVERTIBLE.has(menu_block.name)
				? editor.commands
						.forSurface('turn_into')
						.filter(enabled)
						.map((command) => ({ ...command, group: 'Turn into' }))
				: [];
			return [...turn_into, ...blockActions(menu_block)];
		}
		return [];
	});

	function blockActions(block: HoveredBlock): EditorCommand[] {
		return [
			{
				name: '_duplicate',
				label: 'Duplicate',
				description: 'Insert a copy below',
				icon: icons.duplicate,
				group: 'Actions',
				run: () => duplicateBlock(block.pos),
			},
			{
				name: '_delete',
				label: 'Delete',
				description: 'Remove this block',
				icon: icons.trash,
				group: 'Actions',
				run: () => editor.deleteNode(block.pos),
			},
		];
	}

	function duplicateBlock(pos: number): boolean {
		const node = editor.state.doc.nodeAt(pos);
		if (!node) return false;
		// The copied block_id is deduped by the block-id plugin
		const tr = editor.state.tr
			.insert(pos + node.nodeSize, node.copy(node.content))
			.scrollIntoView();
		editor.dispatch(tr);
		return true;
	}

	// Window-level tracking: the affordance appears as soon as the pointer is
	// anywhere on the block's row — including the gutter strip itself, before
	// ever touching the block's content. No "hover the text first" dance.
	$effect(() => {
		if (!editor.editable) {
			hovered = null;
			return;
		}
		const onMove = (event: PointerEvent) => {
			if (menu_open) return;
			const rect = container.getBoundingClientRect();
			if (
				event.clientX < rect.left - GUTTER_WIDTH ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			) {
				hovered = null;
				return;
			}
			const block = editor.blockAt({ x: event.clientX, y: event.clientY });
			hovered = block;
			if (block) {
				const node = editor.state.doc.nodeAt(block.pos);
				hovered_empty = node?.type.name === 'paragraph' && node.content.size === 0;
			}
		};
		window.addEventListener('pointermove', onMove, { passive: true });
		return () => window.removeEventListener('pointermove', onMove);
	});

	// Hide the gutter while typing (it reappears on pointer movement)
	$effect(() => {
		void editor.doc;
		if (!menu_open) hovered = null;
	});

	const gutter_style = $derived.by(() => {
		const block = menu_block ?? hovered;
		if (!block) return null;
		const container_rect = container.getBoundingClientRect();
		const top = block.rect.top - container_rect.top;
		// The strip covers the whole block height so the pointer can travel
		// from the text to the button without a dead zone
		return `top: ${top}px; block-size: ${Math.max(block.rect.height, 24)}px;`;
	});

	function openMenu(mode: 'insert' | 'actions') {
		menu_block = hovered;
		menu_open = mode;
		selected = mode === 'insert' ? 0 : -1;
	}

	function closeMenu() {
		menu_open = false;
		menu_block = null;
	}

	function pick(command: EditorCommand) {
		const block = menu_block;
		const mode = menu_open;
		closeMenu();
		if (!block) return;
		if (command.name === '_duplicate' || command.name === '_delete') {
			command.run(editor);
			return;
		}
		const node = editor.state.doc.nodeAt(block.pos);
		if (!node) return;
		const is_empty_paragraph = node.type.name === 'paragraph' && node.content.size === 0;
		if (mode === 'actions' || is_empty_paragraph) {
			// Convert in place: select inside the block, then run
			editor.dispatch(
				editor.state.tr.setSelection(
					TextSelection.near(editor.state.doc.resolve(block.pos + 1)),
				),
			);
		} else {
			// Insert a fresh paragraph below the block and run the command there
			const after = block.pos + node.nodeSize;
			const paragraph = editor.schema.nodes.paragraph.create();
			let tr = editor.state.tr.insert(after, paragraph);
			tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
			editor.dispatch(tr);
		}
		editor.focus();
		command.run(editor);
	}

	/**
	 * Start a native drag of the hovered block. Setting `view.dragging` lets
	 * ProseMirror's own (depth-aware) drop logic perform the move — the
	 * custom code is only hover tracking + this handoff.
	 */
	function startDrag(event: DragEvent) {
		const block = hovered ?? menu_block;
		const view = editor.view;
		if (!block || !view || !event.dataTransfer) return;
		editor.selectNode(block.pos);
		const slice = editor.state.selection.content();
		const serializer = DOMSerializer.fromSchema(editor.schema);
		const holder = document.createElement('div');
		holder.appendChild(serializer.serializeFragment(slice.content));
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/html', holder.innerHTML);
		event.dataTransfer.setData(
			'text/plain',
			slice.content.textBetween(0, slice.content.size, '\n'),
		);
		const dom = view.nodeDOM(block.pos);
		if (dom instanceof HTMLElement) {
			event.dataTransfer.setDragImage(dom, 16, 16);
		}
		view.dragging = { slice, move: true };
	}

	const menu_position = $derived.by(() => {
		if (!menu_open || !menu_block) return null;
		const height = menu_el?.offsetHeight ?? 304;
		const viewport_h = typeof window === 'undefined' ? 800 : window.innerHeight;
		let top = menu_block.rect.top;
		if (top + height > viewport_h - 8) top = Math.max(8, viewport_h - height - 8);
		const container_rect = container.getBoundingClientRect();
		const left = Math.max(8, container_rect.left - 8);
		return { left, top };
	});
</script>

<svelte:window
	onpointerdown={(event) => {
		if (!menu_open) return;
		const target = event.target as Node;
		// A detached target was ours too: opening the menu can re-render the
		// gutter and destroy the clicked button before this listener runs.
		if (menu_el?.contains(target) || gutter_el?.contains(target) || !target.isConnected)
			return;
		closeMenu();
	}}
	onkeydown={(event) => {
		if (!menu_open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu();
			editor.focus();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			selected = items.length ? (selected + 1) % items.length : 0;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			selected = items.length ? (selected - 1 + items.length) % items.length : 0;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (items[selected]) pick(items[selected]);
		}
	}} />

{#if (hovered || menu_block) && editor.editable && gutter_style}
	<div class="gutter" style={gutter_style} bind:this={gutter_el}>
		<div class="affordance">
			{#if menu_open === 'insert' || (!menu_open && hovered_empty)}
				<Button
					icon
					transparent
					size="0"
					dense
					aria-label="Add block"
					tooltip="Add block"
					onpointerdown={(event: PointerEvent) => {
						event.preventDefault();
						if (menu_open) closeMenu();
						else openMenu('insert');
					}}>
					{@html icons.plus}
				</Button>
			{:else}
				<Button
					icon
					transparent
					size="0"
					dense
					class="handle"
					aria-label="Block actions (drag to move)"
					tooltip="Click for actions, drag to move"
					draggable="true"
					ondragstart={startDrag}
					ondragend={() => (hovered = null)}
					onclick={() => {
						if (menu_open) closeMenu();
						else openMenu('actions');
					}}>
					{@html icons.drag}
				</Button>
			{/if}
		</div>
	</div>
{/if}

{#if menu_open && menu_position}
	<div
		class="menu-wrap"
		style:left="{menu_position.left}px"
		style:top="{menu_position.top}px"
		bind:this={menu_el}
		use:portal>
		<CommandMenu
			{items}
			{selected}
			onhover={(index) => (selected = index)}
			onpick={pick} />
	</div>
{/if}

<style>
	.gutter {
		/* A full-height hover strip touching the content edge — the button
		   stays mounted anywhere along the path to it */
		position: absolute;
		inset-inline-start: -3.5rem;
		inline-size: 3.5rem;
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		z-index: 5;
	}

	.affordance {
		display: flex;
		align-items: center;
		block-size: 1.7em;
		padding-inline-end: 0.375rem;
		color: var(--color-text-muted, color-mix(in oklab, currentColor 55%, transparent));
		opacity: 0;
		animation: ds-editor-gutter-in 150ms ease forwards;

		:global(.handle button) {
			cursor: grab;

			&:active {
				cursor: grabbing;
			}
		}
	}

	.menu-wrap {
		position: fixed;
		z-index: 50;
	}

	@keyframes -global-ds-editor-gutter-in {
		to {
			opacity: 1;
		}
	}
</style>
