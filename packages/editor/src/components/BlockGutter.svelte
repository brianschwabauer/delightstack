<script lang="ts">
	import { untrack } from 'svelte';
	import { TextSelection, type SelectionBookmark } from 'prosemirror-state';
	import { DOMSerializer } from 'prosemirror-model';
	import { Button } from '@delightstack/components';
	import type { Editor } from '../core/editor.svelte.js';
	import type { EditorCommand } from '../types/index.js';
	import { moveBlock } from '../core/commands.js';
	import { icons } from '../core/icons.js';
	import { portal } from './portal.js';
	import { surfaceIn, surfaceOut } from './motion.js';
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

	/** Width of the hover strip left of the content, in rem (see .gutter) */
	const GUTTER_WIDTH_REM = 3.5;

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
				name: '_move_up',
				label: 'Move up',
				description: 'Swap with the block above',
				icon: icons.arrow_up,
				keyboard: 'Alt-ArrowUp',
				group: 'Actions',
				run: () => runMove(block, -1),
			},
			{
				name: '_move_down',
				label: 'Move down',
				description: 'Swap with the block below',
				icon: icons.arrow_down,
				keyboard: 'Alt-ArrowDown',
				group: 'Actions',
				run: () => runMove(block, 1),
			},
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

	function runMove(block: HoveredBlock, direction: -1 | 1): boolean {
		const node = editor.state.doc.nodeAt(block.pos);
		if (!node) return false;
		editor.selectNode(block.pos);
		return Boolean(moveBlock(direction)(editor.state, (tr) => editor.dispatch(tr)));
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
		// The hit zone must match the CSS strip (3.5rem) at any root font size
		const gutter_px =
			GUTTER_WIDTH_REM *
			(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
		// rAF-throttled: the handler forces layout (getBoundingClientRect +
		// posAtCoords), so it must not run at raw pointer frequency
		let frame = 0;
		const measure = () => {
			frame = 0;
			const event = last_point;
			if (!event || menu_open) return;
			const rect = container.getBoundingClientRect();
			if (
				event.clientX < rect.left - gutter_px ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			) {
				hovered = null;
				hovered_empty = false;
				return;
			}
			const block = editor.blockAt({ x: event.clientX, y: event.clientY });
			// Same block, same geometry → keep the existing object so nothing
			// downstream re-derives
			if (
				block &&
				hovered &&
				block.pos === hovered.pos &&
				block.rect.top === hovered.rect.top &&
				block.rect.height === hovered.rect.height
			) {
				return;
			}
			hovered = block;
			if (block) {
				const node = editor.state.doc.nodeAt(block.pos);
				hovered_empty = node?.type.name === 'paragraph' && node.content.size === 0;
			} else {
				hovered_empty = false;
			}
		};
		const onMove = (event: PointerEvent) => {
			last_point = { clientX: event.clientX, clientY: event.clientY };
			if (!frame) frame = requestAnimationFrame(measure);
		};
		window.addEventListener('pointermove', onMove, { passive: true });
		return () => {
			window.removeEventListener('pointermove', onMove);
			if (frame) cancelAnimationFrame(frame);
		};
	});

	/** Last pointer location, for re-anchoring without pointer movement */
	let last_point: { clientX: number; clientY: number } | null = null;

	// Re-anchor the visible handle when a doc change reflows the page under a
	// stationary pointer (image finished loading, collaborator edit above)
	$effect(() => {
		void editor.doc;
		untrack(() => {
			if (menu_open || !hovered || !last_point) return;
			const block = editor.blockAt({ x: last_point.clientX, y: last_point.clientY });
			hovered = block;
			if (!block) hovered_empty = false;
		});
	});

	// Hide the gutter while typing (it reappears on pointer movement). Keyed
	// off real keystrokes in the editor — doc changes alone also arrive from
	// collaborators and background upload progress, and the handle blinking
	// away under a stationary pointer reads as random flicker.
	$effect(() => {
		const onKeydown = (event: KeyboardEvent) => {
			if (menu_open) return;
			if (
				event.key.length === 1 ||
				['Backspace', 'Delete', 'Enter'].includes(event.key)
			) {
				hovered = null;
				hovered_empty = false;
			}
		};
		container.addEventListener('keydown', onKeydown);
		return () => container.removeEventListener('keydown', onKeydown);
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
	let drag_prior_selection: SelectionBookmark | null = null;

	function startDrag(event: DragEvent) {
		const block = hovered ?? menu_block;
		const view = editor.view;
		if (!block || !view || !event.dataTransfer) return;
		// ProseMirror's move-on-drop deletes the current selection, so the
		// dragged node must be selected — but remember what the user had so a
		// cancelled drag can put it back.
		drag_prior_selection = editor.state.selection.getBookmark();
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
			const rect = dom.getBoundingClientRect();
			// Anchor the ghost where the block actually sits relative to the
			// pointer so it doesn't jump under the cursor at drag start.
			event.dataTransfer.setDragImage(
				dom,
				Math.max(0, event.clientX - rect.left),
				Math.max(0, event.clientY - rect.top),
			);
		}
		view.dragging = { slice, move: true };
	}

	/**
	 * ProseMirror only clears `view.dragging` from its own dragend handler on
	 * `view.dom` — our drag source lives outside it, so a cancelled drag would
	 * leave a stale `move: true` behind and the next unrelated drop would
	 * delete the previously dragged block. Clean up here, and put the user's
	 * selection back when nothing was dropped.
	 */
	function endDrag(event: DragEvent) {
		hovered = null;
		const view = editor.view;
		if (view) view.dragging = null;
		if (event.dataTransfer?.dropEffect === 'none' && drag_prior_selection) {
			try {
				const selection = drag_prior_selection.resolve(editor.state.doc);
				editor.dispatch(editor.state.tr.setSelection(selection));
			} catch {
				// The document changed under the bookmark; leave selection as is
			}
		}
		drag_prior_selection = null;
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
	onscrollcapture={(event) => {
		// The menu is fixed-position from a snapshot rect — scrolling would
		// strand it over unrelated content, so close it (scrolls inside the
		// menu's own list are fine)
		if (!menu_open) return;
		if (event.target instanceof Node && menu_el?.contains(event.target)) return;
		closeMenu();
	}}
	onresize={() => {
		if (menu_open) closeMenu();
	}}
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
	<div class="gutter" style={gutter_style} out:surfaceOut bind:this={gutter_el}>
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
						if (event.button !== 0) return;
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
					ondragend={endDrag}
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
		in:surfaceIn
		out:surfaceOut
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
