<script lang="ts">
	import { Button } from '@delightstack/components';
	import type { Editor } from '../core/editor.svelte.js';
	import { icons } from '../core/icons.js';
	import { portal } from './portal.js';
	import { surfaceOut } from './motion.js';
	import { findScroller } from '../core/plugins/drop.js';
	import LinkEditor from './LinkEditor.svelte';

	interface Props {
		editor: Editor;
	}

	let { editor }: Props = $props();

	let pointer_down = $state(false);
	let menu_el = $state<HTMLElement | null>(null);
	let link_open = $state(false);
	// Reactive dimensions (Svelte backs these with a ResizeObserver): the
	// menu re-clamps when its content changes size, e.g. when the link
	// editor swaps in and the panel grows
	let menu_width = $state(0);
	let menu_height = $state(0);

	const all_commands = $derived(editor.commands.forSurface('floating'));
	// Marks first, then block turn-into toggles (headings/quote) after a divider
	const commands = $derived(all_commands.filter((command) => !command.group));
	const block_commands = $derived(all_commands.filter((command) => command.group));

	const visible = $derived(
		!editor.selection.empty &&
			editor.selection.type === 'text' &&
			(editor.focused || link_open) &&
			editor.editable &&
			!pointer_down,
	);

	// Bumped by any scroll (capture catches nested scrollers) so the anchor
	// re-measures and the menu follows the selection instead of stranding at
	// stale viewport coordinates.
	let scroll_tick = $state(0);

	// Selection viewport anchor (recomputed when the selection changes)
	const anchor = $derived.by(() => {
		void scroll_tick;
		if (!visible) return null;
		const view = editor.view;
		if (!view) return null;
		const { from, to } = editor.selection;
		try {
			const start = view.coordsAtPos(from);
			const end = view.coordsAtPos(to, -1);
			const left = Math.min(start.left, end.left);
			const right = Math.max(start.right, end.right);
			return {
				left,
				right,
				top: Math.min(start.top, end.top),
				bottom: Math.max(start.bottom, end.bottom),
			};
		} catch {
			return null;
		}
	});

	// The menu is confined to the editor's scroll container (when there is
	// one): scrolling a selection out of view takes the toolbar with it
	// instead of stranding it over unrelated page chrome.
	const bounds = $derived.by(() => {
		void scroll_tick;
		const viewport_w = typeof window === 'undefined' ? 1200 : window.innerWidth;
		const viewport_h = typeof window === 'undefined' ? 800 : window.innerHeight;
		let top = 8;
		let bottom = viewport_h - 8;
		let left = 8;
		let right = viewport_w - 8;
		const view = editor.view;
		const scroller = view ? findScroller(view.dom) : null;
		if (scroller) {
			const rect = scroller.getBoundingClientRect();
			top = Math.max(top, rect.top);
			bottom = Math.min(bottom, rect.bottom);
			left = Math.max(left, rect.left);
			right = Math.min(right, rect.right);
		}
		return { top, bottom, left, right };
	});

	const position = $derived.by(() => {
		if (!anchor) return null;
		const width = menu_width || 320;
		const height = menu_height || 44;
		// The selection scrolled out of the container — hide entirely
		if (anchor.bottom < bounds.top || anchor.top > bounds.bottom) return null;
		let top = anchor.top - height - 8;
		if (top < bounds.top) top = anchor.bottom + 8;
		// A selection at the very bottom with no room above either: keep the
		// toolbar inside the container rather than below its fold
		top = Math.max(bounds.top, Math.min(top, bounds.bottom - height));
		const center = (anchor.left + anchor.right) / 2;
		const left = Math.max(
			bounds.left,
			Math.min(center - width / 2, bounds.right - width),
		);
		return { left, top };
	});

	$effect(() => {
		if (!visible) link_open = false;
	});

	function onWindowPointer(down: boolean) {
		return (event: PointerEvent) => {
			// Ignore pointer interactions inside the menu itself. A target that
			// is no longer connected was inside it too: clicking a menu button
			// can swap the menu contents (link editor) before this window-level
			// listener runs, detaching the button mid-dispatch.
			if (
				menu_el &&
				event.target instanceof Node &&
				(menu_el.contains(event.target) || !event.target.isConnected)
			)
				return;
			pointer_down = down;
		};
	}
</script>

<svelte:window
	onpointerdown={onWindowPointer(true)}
	onpointerup={onWindowPointer(false)}
	onpointercancel={() => (pointer_down = false)}
	onblur={() => (pointer_down = false)}
	onscrollcapture={() => (scroll_tick = scroll_tick + 1)}
	onresize={() => (scroll_tick = scroll_tick + 1)} />

{#snippet action(command: import('../types/index.js').EditorCommand)}
	<Button
		icon
		transparent
		dense
		size="0"
		active={command.is_active?.(editor) ?? false}
		aria-label={command.label}
		tooltip={command.label}
		onpointerdown={(event: PointerEvent) => {
			if (event.button !== 0) return;
			event.preventDefault();
			command.run(editor);
		}}>
		{#if typeof command.icon === 'string'}
			{@html command.icon}
		{/if}
	</Button>
{/snippet}

{#if visible && position}
	<!-- No entrance animation: the toolbar materializes and tracks the
	     selection instantly (shift+arrow growth just slides it along) -->
	<div
		class="floating"
		out:surfaceOut
		role="toolbar"
		aria-label="Text formatting"
		style:left="{position.left}px"
		style:top="{position.top}px"
		style:visibility={menu_height ? null : 'hidden'}
		bind:this={menu_el}
		bind:offsetWidth={menu_width}
		bind:offsetHeight={menu_height}
		use:portal>
		{#if link_open}
			<LinkEditor {editor} onclose={() => (link_open = false)} />
		{:else}
			{#each commands as command (command.name)}
				{@render action(command)}
			{/each}
			{#if block_commands.length}
				<span class="divider"></span>
				{#each block_commands as command (command.name)}
					{@render action(command)}
				{/each}
			{/if}
			{#if editor.schema.marks.link}
				<span class="divider"></span>
				<Button
					icon
					transparent
					dense
					size="0"
					active={'link' in editor.active_marks}
					aria-label="Link"
					tooltip="Link"
					onpointerdown={(event: PointerEvent) => {
						if (event.button !== 0) return;
						event.preventDefault();
						link_open = true;
					}}>
					{@html icons.link}
				</Button>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.floating {
		position: fixed;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		color: var(--color-text-muted);
		background: var(--color-surface, Canvas);
		border: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
		border-radius: min(var(--radius-lg, 12px), var(--radius-cap, 40px));
		box-shadow: var(
			--shadow-lg,
			0 4px 12px rgb(0 0 0 / 8%),
			0 12px 32px rgb(0 0 0 / 12%)
		);

		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: min(
				calc(var(--radius-lg, 12px) * var(--squircle-ratio, 2)),
				calc(var(--radius-cap, 40px) * var(--squircle-ratio, 2))
			);
		}
	}

	.divider {
		inline-size: 1px;
		block-size: 1.25rem;
		background: var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
		margin-inline: 2px;
	}
</style>
