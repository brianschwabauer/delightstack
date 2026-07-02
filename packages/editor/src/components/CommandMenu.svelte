<script module lang="ts">
	const IS_MAC =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

	function formatKeyboard(binding: string): string {
		return binding
			.replace(/Mod/g, IS_MAC ? '⌘' : 'Ctrl')
			.replace(/Alt/g, IS_MAC ? '⌥' : 'Alt')
			.replace(/Shift/g, IS_MAC ? '⇧' : 'Shift')
			.replaceAll('-', IS_MAC ? '' : '+');
	}
</script>

<script lang="ts">
	import type { EditorCommand } from '../types/index.js';

	interface Props {
		items: EditorCommand[];
		/** Index into `items` of the highlighted entry (-1 for none) */
		selected?: number;
		/** Render without the popover chrome (when hosted inside another surface) */
		flat?: boolean;
		onpick: (command: EditorCommand) => void;
		onhover?: (index: number) => void;
		empty_message?: string;
	}

	let {
		items,
		selected = 0,
		flat = false,
		onpick,
		onhover = undefined,
		empty_message = 'No matching commands',
	}: Props = $props();

	// Group items while preserving order; ungrouped items go under ''
	const groups = $derived.by(() => {
		const map = new Map<string, { command: EditorCommand; index: number }[]>();
		items.forEach((command, index) => {
			const group = command.group ?? '';
			if (!map.has(group)) map.set(group, []);
			map.get(group)!.push({ command, index });
		});
		return [...map.entries()];
	});

	let list = $state<HTMLElement | null>(null);

	$effect(() => {
		// Keep the highlighted item in view during keyboard navigation
		if (selected < 0) return;
		const el = list?.querySelector(`[data-index="${selected}"]`);
		el?.scrollIntoView({ block: 'nearest' });
	});

	// Roving focus for hosts without their own keyboard wiring (the toolbar
	// "+" menu). The slash menu drives `selected` from the editor instead —
	// focus never enters the list there, so this stays inert.
	function onListKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const items_els = Array.from(list?.querySelectorAll<HTMLElement>('.item') ?? []);
		if (!items_els.length) return;
		const current = items_els.indexOf(document.activeElement as HTMLElement);
		const step = event.key === 'ArrowDown' ? 1 : -1;
		const next = (current + step + items_els.length) % items_els.length;
		items_els[next].focus();
		event.preventDefault();
	}
</script>

<div
	class="menu"
	class:flat
	role="listbox"
	tabindex="-1"
	bind:this={list}
	onkeydown={onListKeydown}>
	{#if items.length === 0}
		<div class="empty">{empty_message}</div>
	{/if}
	{#each groups as [group, entries] (group)}
		{#if group}
			<div class="group">{group}</div>
		{/if}
		{#each entries as { command, index } (command.name)}
			<button
				type="button"
				role="option"
				aria-selected={index === selected}
				class="item"
				class:selected={index === selected}
				data-index={index}
				onpointerenter={() => onhover?.(index)}
				onpointerdown={(event) => {
					// pointerdown (not click) so the editor keeps focus/selection
					if (event.button !== 0) return;
					event.preventDefault();
					onpick(command);
				}}
				onclick={(event) => {
					// Keyboard activation (Enter/Space on a focused item) comes
					// through as a click with detail 0 — pointer picks already
					// ran on pointerdown
					if (event.detail === 0) onpick(command);
				}}>
				{#if typeof command.icon === 'string'}
					<span class="icon">{@html command.icon}</span>
				{:else if command.icon}
					{@const Icon = command.icon}
					<span class="icon"><Icon /></span>
				{:else}
					<span class="icon"></span>
				{/if}
				<span class="text">
					<span class="label">{command.label}</span>
					{#if command.description}
						<span class="description">{command.description}</span>
					{/if}
				</span>
				{#if command.keyboard}
					<kbd>{formatKeyboard(command.keyboard)}</kbd>
				{/if}
			</button>
		{/each}
	{/each}
</div>

<style>
	.menu {
		min-width: 16rem;
		max-width: 20rem;
		max-height: 19rem;
		overflow-y: auto;
		background: var(--color-surface, Canvas);
		border: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 15%, transparent));
		border-radius: min(var(--radius-lg, 12px), var(--radius-cap, 40px));
		box-shadow: var(
			--shadow-lg,
			0 4px 12px rgb(0 0 0 / 8%),
			0 12px 32px rgb(0 0 0 / 12%)
		);
		padding: 0.375rem;

		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: min(
				calc(var(--radius-lg, 12px) * var(--squircle-ratio, 2)),
				calc(var(--radius-cap, 40px) * var(--squircle-ratio, 2))
			);
		}

		&.flat {
			background: none;
			border: none;
			box-shadow: none;
			border-radius: 0;
			max-height: none;
			padding: 0.25rem;
		}
	}

	.empty {
		padding: 0.75rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
		text-align: center;
	}

	.group {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
		padding: 0.5rem 0.5rem 0.25rem;

		&:first-child {
			padding-block-start: 0.25rem;
		}
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: none;
		background: none;
		border-radius: var(--radius, 8px);
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;
		/* Short trail: 300ms left a smear of stale highlights while arrowing
		   quickly through the list */
		transition: background-color 120ms var(--ease-out, ease);

		&:hover,
		&.selected {
			background: var(
				--color-bg-active,
				color-mix(in oklab, currentColor 8%, transparent)
			);
			transition: none;
		}

		&:focus-visible {
			outline: 2px solid var(--action, var(--color-primary));
			outline-offset: -2px;
		}
	}

	.icon {
		flex: 0 0 auto;
		inline-size: 1.25rem;
		block-size: 1.25rem;
		display: grid;
		place-items: center;
		color: var(--color-text-muted);

		:global(svg) {
			inline-size: 100%;
			block-size: 100%;
		}
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.label {
		font-size: 0.875rem;
		line-height: 1.3;
	}

	.description {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	kbd {
		flex: 0 0 auto;
		font-family: inherit;
		font-size: 0.6875rem;
		color: var(--color-text-muted);
		background: var(--color-bg-muted, color-mix(in oklab, currentColor 8%, transparent));
		border-radius: calc(var(--radius, 8px) / 2);
		padding: 0.125rem 0.375rem;
	}
</style>
