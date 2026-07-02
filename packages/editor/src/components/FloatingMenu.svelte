<script lang="ts">
	import { Button } from '@delightstack/components';
	import type { Editor } from '../core/editor.svelte.js';
	import { icons } from '../core/icons.js';
	import { portal } from './portal.js';
	import LinkEditor from './LinkEditor.svelte';

	interface Props {
		editor: Editor;
	}

	let { editor }: Props = $props();

	let pointer_down = $state(false);
	let menu_el = $state<HTMLElement | null>(null);
	let link_open = $state(false);

	const commands = $derived(editor.commands.forSurface('floating'));

	const visible = $derived(
		!editor.selection.empty &&
			editor.selection.type === 'text' &&
			(editor.focused || link_open) &&
			editor.editable &&
			!pointer_down,
	);

	// Selection viewport anchor (recomputed when the selection changes)
	const anchor = $derived.by(() => {
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

	const position = $derived.by(() => {
		if (!anchor) return null;
		const width = menu_el?.offsetWidth ?? 320;
		const height = menu_el?.offsetHeight ?? 44;
		const viewport_w = typeof window === 'undefined' ? 1200 : window.innerWidth;
		let top = anchor.top - height - 8;
		if (top < 8) top = anchor.bottom + 8;
		const center = (anchor.left + anchor.right) / 2;
		const left = Math.max(8, Math.min(center - width / 2, viewport_w - width - 8));
		return { left, top };
	});

	$effect(() => {
		if (!visible) link_open = false;
	});

	function onWindowPointer(down: boolean) {
		return (event: PointerEvent) => {
			// Ignore pointer interactions inside the menu itself
			if (menu_el && event.target instanceof Node && menu_el.contains(event.target))
				return;
			pointer_down = down;
		};
	}
</script>

<svelte:window
	onpointerdown={onWindowPointer(true)}
	onpointerup={onWindowPointer(false)} />

{#if visible && position}
	<div
		class="floating"
		role="toolbar"
		aria-label="Text formatting"
		style:left="{position.left}px"
		style:top="{position.top}px"
		bind:this={menu_el}
		use:portal>
		{#if link_open}
			<LinkEditor {editor} onclose={() => (link_open = false)} />
		{:else}
			{#each commands as command (command.name)}
				<Button
					icon
					transparent
					dense
					size="0"
					active={command.is_active?.(editor) ?? false}
					aria-label={command.label}
					tooltip={command.label}
					onpointerdown={(event: PointerEvent) => {
						event.preventDefault();
						command.run(editor);
					}}>
					{#if typeof command.icon === 'string'}
						{@html command.icon}
					{/if}
				</Button>
			{/each}
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
		box-shadow:
			0 4px 12px rgb(0 0 0 / 8%),
			0 12px 32px rgb(0 0 0 / 12%);

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
