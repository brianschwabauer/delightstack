<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '@delightstack/components';
	import type { Editor } from '../core/editor.svelte.js';
	import type { EditorCommand } from '../types/index.js';
	import { icons } from '../core/icons.js';
	import CommandMenu from './CommandMenu.svelte';

	interface Props {
		editor: Editor;
		/** Include undo/redo buttons. Default true */
		show_history?: boolean;
		/** Include the add-block (+) menu. Default true */
		show_add_block?: boolean;
		/** Custom content replaces the default button row */
		children?: Snippet;
		class?: string;
	}

	let {
		editor,
		show_history = true,
		show_add_block = true,
		children = undefined,
		class: class_name = '',
	}: Props = $props();

	// The simplified toolbar: 90% of the time users are doing plain text
	// manipulation, so it's marks + headings only. Every block type (lists,
	// quotes, code, media, …) lives behind the single + menu instead of an
	// ever-growing button row.
	const commands = $derived(editor.commands.forSurface('toolbar'));
	const mark_commands = $derived(
		commands.filter((command) => command.surfaces?.includes('floating')),
	);
	const heading_commands = $derived(
		commands.filter((command) => !command.surfaces?.includes('floating')),
	);

	const add_commands = $derived(
		editor.commands
			.forSurface('plus')
			.filter((command) => !command.is_enabled || command.is_enabled(editor)),
	);

	function insert(command: EditorCommand, close: () => void) {
		close();
		editor.focus();
		command.run(editor);
	}
</script>

<div class="toolbar {class_name}" role="toolbar" aria-label="Editor toolbar">
	{#if children}
		{@render children()}
	{:else}
		{#if show_history}
			<Button
				icon
				transparent
				dense
				size="0"
				aria-label="Undo"
				tooltip="Undo"
				disabled={!editor.can_undo}
				onpointerdown={(event: PointerEvent) => {
					event.preventDefault();
					editor.undo();
				}}>
				{@html icons.undo}
			</Button>
			<Button
				icon
				transparent
				dense
				size="0"
				aria-label="Redo"
				tooltip="Redo"
				disabled={!editor.can_redo}
				onpointerdown={(event: PointerEvent) => {
					event.preventDefault();
					editor.redo();
				}}>
				{@html icons.redo}
			</Button>
			<span class="divider"></span>
		{/if}
		{#each mark_commands as command (command.name)}
			{@render action(command)}
		{/each}
		{#if mark_commands.length && heading_commands.length}
			<span class="divider"></span>
		{/if}
		{#each heading_commands as command (command.name)}
			{@render action(command)}
		{/each}
		{#if show_add_block && add_commands.length}
			<span class="divider"></span>
			<Button
				icon
				transparent
				dense
				size="0"
				aria-label="Add block"
				tooltip="Add block"
				popover_placement="bottom-start"
				menu={add_menu as never}>
				{@html icons.plus}
			</Button>
		{/if}
	{/if}
</div>

{#snippet add_menu({ close }: { close: () => void })}
	<div class="add-menu">
		<CommandMenu
			items={add_commands}
			selected={-1}
			flat
			onpick={(command) => insert(command, close)} />
	</div>
{/snippet}

{#snippet action(command: EditorCommand)}
	<Button
		icon
		transparent
		dense
		size="0"
		active={command.is_active?.(editor) ?? false}
		aria-label={command.label}
		tooltip={command.label}
		disabled={command.is_enabled ? !command.is_enabled(editor) : false}
		onpointerdown={(event: PointerEvent) => {
			event.preventDefault();
			command.run(editor);
		}}>
		{#if typeof command.icon === 'string'}
			{@html command.icon}
		{:else if command.icon}
			{@const Icon = command.icon}
			<Icon />
		{:else}
			<span class="fallback">{command.label.slice(0, 2)}</span>
		{/if}
	</Button>
{/snippet}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
		padding: 4px;
		color: var(--color-text-muted);
		background: var(--color-surface, Canvas);
		border: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
		border-radius: min(var(--radius-lg, 12px), var(--radius-cap, 40px));

		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: min(
				calc(var(--radius-lg, 12px) * var(--squircle-ratio, 2)),
				calc(var(--radius-cap, 40px) * var(--squircle-ratio, 2))
			);
		}
	}

	.fallback {
		font-size: 0.75rem;
		font-weight: 600;
	}

	.divider {
		inline-size: 1px;
		block-size: 1.25rem;
		background: var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
		margin-inline: 4px;
	}

	.add-menu {
		max-block-size: min(24rem, 60vh);
		overflow-y: auto;
	}
</style>
