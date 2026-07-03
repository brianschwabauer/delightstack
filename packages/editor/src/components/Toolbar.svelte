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
	// Marks are ungrouped; block-type commands (headings) carry a group
	const mark_commands = $derived(commands.filter((command) => !command.group));
	const heading_commands = $derived(commands.filter((command) => command.group));

	const add_commands = $derived(
		editor.commands
			.forSurface('plus')
			.filter((command) => !command.is_enabled || command.is_enabled(editor)),
	);

	// Fuzzy search over the + menu (same scorer as the slash menu)
	let add_query = $state('');
	let add_selected = $state(0);
	const add_results = $derived(
		editor.commands
			.search(add_query, 'plus')
			.filter((command) => !command.is_enabled || command.is_enabled(editor)),
	);

	function insert(command: EditorCommand, close: () => void) {
		close();
		editor.focus();
		command.run(editor);
	}

	function onAddSearchKeydown(event: KeyboardEvent, close: () => void) {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				add_selected = add_results.length ? (add_selected + 1) % add_results.length : 0;
				break;
			case 'ArrowUp':
				event.preventDefault();
				add_selected = add_results.length
					? (add_selected - 1 + add_results.length) % add_results.length
					: 0;
				break;
			case 'Enter': {
				event.preventDefault();
				const command = add_results[add_selected];
				if (command) insert(command, close);
				break;
			}
		}
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
					if (event.button !== 0) return;
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
					if (event.button !== 0) return;
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
	<div class="add-search">
		<input
			type="text"
			placeholder="Search blocks…"
			aria-label="Search blocks"
			bind:value={add_query}
			oninput={() => (add_selected = 0)}
			onkeydown={(event) => onAddSearchKeydown(event, close)}
			{@attach (el: HTMLInputElement) => {
				// Fresh query + focus every time the popover opens
				add_query = '';
				add_selected = 0;
				el.focus();
			}} />
	</div>
	<div class="add-menu">
		<CommandMenu
			items={add_results}
			selected={add_selected}
			flat
			onhover={(index) => (add_selected = index)}
			onpick={(command) => insert(command, close)}
			empty_message="No matching blocks" />
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
			if (event.button !== 0) return;
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

	.add-search {
		padding: 0.375rem 0.375rem 0;

		input {
			inline-size: 100%;
			font: inherit;
			font-size: 0.875rem;
			color: inherit;
			background: var(
				--color-bg-muted,
				color-mix(in oklab, currentColor 6%, transparent)
			);
			border: 1px solid
				var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
			border-radius: var(--radius, 8px);
			padding: 0.375rem 0.625rem;
			outline: none;

			&:focus-visible {
				border-color: var(--action, var(--color-primary));
			}

			&::placeholder {
				color: var(
					--color-text-disabled,
					color-mix(in oklab, currentColor 40%, transparent)
				);
			}
		}
	}
</style>
