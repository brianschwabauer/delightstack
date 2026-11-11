<script lang="ts" module>
	import {
		onDestroy,
		onMount,
		tick,
		untrack,
		type Component,
		type Snippet,
	} from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import Popover from './Popover.svelte';
	import List from './../display/List.svelte';
	import ListItem from './../display/ListItem.svelte';

	export interface ContextMenuOptions {
		/** The list of action menu items to show in the context menu */
		actions: Array<{
			/** A callback that will be called when this action is clicked */
			onclick?: (event: PointerEvent) => void | Promise<void>;
			/** An optional href to navigate to when this action is clicked */
			href?: string;
			/** The target for the href, if any */
			target?: '_blank' | '_self' | '_parent' | '_top';
			/** Whether the action item should have an "active" look to it (highlighed) */
			active?: boolean;
			/** The label text to show for this action */
			label?: string;
			/** Whether this action is disabled or not */
			disabled?: boolean;
			/** The icon component to display before the label text */
			icon?: Component<Record<string, unknown>>;
			/** An optional snippet that will be used to render the content of the action (instead of using 'label') */
			snippet?: Snippet<[ContextMenuOptions & { el: HTMLElement }]>;
			/**
			 * The keys that trigger this action elsewhere, shown on the item's trailing
			 * edge (e.g. `['⌘', 'D']`). Display only; the menu doesn't bind them.
			 */
			shortcut?: string[];
			/**
			 * Actions that share a group sit together, and a hairline separates one group
			 * from the next. A divider is drawn wherever the group changes between two
			 * neighbouring actions, so leaving an action out never strands a divider.
			 */
			group?: string;
			/** Render the action in the error color, for destructive actions like Delete */
			danger?: boolean;
		}>;
		/** Use the compact list rows (for pointer menus with many actions) */
		dense?: boolean;
	}

	/** The currently displayed context mneu */
	let activeContextMenu = $state<(ContextMenuOptions & { el: HTMLElement }) | undefined>(
		undefined,
	);

	/** The X location of the context menu, used to position it */
	let contextMenuLocationX = $state<number | undefined>(undefined);

	/** The Y location of the context menu, used to position it */
	let contextMenuLocationY = $state<number | undefined>(undefined);

	// Single-instance election, as in <Toaster />: every <ContextMenu /> shares
	// this module's menu state, so only the first-mounted one renders. Mounting
	// it more than once (e.g. once per docs demo) used to open one popover per
	// instance, stacked on the same spot — their shadows compounded into a
	// heavy dark halo.
	let registered: number[] = [];
	let primary_token = $state<number | null>(null);
	let election_counter = 0;

	/** A record of context menu targets that will be chosen from when the user right clicks the window */
	const contextMenuTargets = new WeakMap<
		HTMLElement,
		ContextMenuOptions & {
			/** The element listening for context menu events */
			el: HTMLElement;
		}
	>();

	/**
	 * A svelte attachment for adding a context menu when a user right clicks the attached element.
	 * If multiple context menus are attached to the same element, the most recently attached one will be used.
	 * If a parent element has a context menu, the child element's context menu will take precedence.
	 * @example
	 * ```svelte
	 * <div {@attach contextMenu({ actions: [{ label: 'Help', onclick: () => {} }] })}>
	 * ```
	 */
	export function contextMenu(options: ContextMenuOptions): Attachment<HTMLElement> {
		return (el: HTMLElement) => {
			if (contextMenuTargets.has(el)) contextMenuTargets.delete(el);
			contextMenuTargets.set(el, { ...options, el });
			return () => {
				contextMenuTargets.delete(el);
				untrack(() => {
					if (activeContextMenu?.el === el) activeContextMenu = undefined;
				});
			};
		};
	}
</script>

<script lang="ts">
	const my_token = ++election_counter;
	onMount(() => {
		registered.push(my_token);
		if (primary_token === null) primary_token = my_token;
	});
	onDestroy(() => {
		const i = registered.indexOf(my_token);
		if (i !== -1) registered.splice(i, 1);
		if (primary_token === my_token) primary_token = registered[0] ?? null;
	});
	const is_primary = $derived(primary_token === my_token);

	/** The menu the popover renders — retained after activeContextMenu clears so the
	 * items don't unmount while the popover panel is still playing its close animation */
	let renderedMenu = $state<(ContextMenuOptions & { el: HTMLElement }) | undefined>(
		undefined,
	);
	$effect(() => {
		if (activeContextMenu?.actions?.length) renderedMenu = activeContextMenu;
	});

	/** Whether the open menu came from a mouse right-click (vs. the keyboard's
	 * context-menu key / Shift+F10, which fires `contextmenu` with button 0). A
	 * pointer-opened menu leaves focus where it was — moving it onto the first
	 * item painted a keyboard focus ring the user never asked for. */
	let opened_with_pointer = $state(true);
</script>

<svelte:window
	oncontextmenu={(event) => {
		if (!is_primary) return;
		let target = event.target as HTMLElement;
		while (target && !contextMenuTargets.has(target)) {
			target = target.parentElement as HTMLElement;
		}
		const contextMenu = contextMenuTargets.get(target);
		if (!contextMenu) return;
		event.preventDefault();
		opened_with_pointer = event.button === 2;
		activeContextMenu = undefined;
		contextMenuLocationX = event.clientX;
		contextMenuLocationY = event.clientY;
		tick().then(() => (activeContextMenu = contextMenu));
	}}
	onscroll={() => {
		if (activeContextMenu) activeContextMenu = undefined;
	}} />

{#if is_primary}
	<Popover
		bind:opened={
			() => !!activeContextMenu?.actions?.length,
			(open) => {
				// The Popover closes itself on outside click / escape / scroll. Funnel
				// that back into clearing the active menu so it fully dismisses (a
				// one-way `opened` prop would leave the menu state stale and re-open it).
				if (!open) activeContextMenu = undefined;
			}
		}
		strategy="fixed"
		close_on_escape_key
		close_on_outside_click
		arrow={false}
		disable_initial_focus={opened_with_pointer}
		radius="var(--radius-lg)"
		x={contextMenuLocationX}
		y={contextMenuLocationY}>
		{#if renderedMenu?.actions?.length}
			<List dense={renderedMenu.dense}>
				{#each renderedMenu.actions as action, i}
					{#if i > 0 && action.group !== renderedMenu.actions[i - 1]?.group}
						<li class="separator" aria-hidden="true"></li>
					{/if}
					<ListItem
						onclick={async (event) => {
							if (action.onclick) await action.onclick(event as PointerEvent);
							activeContextMenu = undefined;
						}}
						active={action.active}
						href={action.href}
						target={action.target}
						disabled={action.disabled}>
						{#if action.snippet}
							{@render action.snippet(renderedMenu)}
						{:else}
							{#if action.icon}
								<span class="icon" class:danger={action.danger}>
									<action.icon></action.icon>
								</span>
							{/if}
							<span class="label" class:danger={action.danger}>{action.label}</span>
							{#if action.shortcut?.length}
								<span class="shortcut">
									{#each action.shortcut as key}<kbd>{key}</kbd>{/each}
								</span>
							{/if}
						{/if}
					</ListItem>
				{/each}
			</List>
		{/if}
	</Popover>
{/if}

<style>
	.icon {
		display: inline-flex;
		align-items: center;
		padding-right: 0.5rem;
		font-size: 1.1rem;
	}
	.label {
		flex: 1;
		min-width: 0;
	}
	.danger {
		color: var(--color-error);
	}
	/* Shortcuts read like a native menu's: quiet text on the trailing edge, not keycaps */
	.shortcut {
		flex: none;
		display: inline-flex;
		gap: 0.125em;
		padding-left: 2rem;
		color: var(--color-text-muted);
		font-size: 0.85em;
		font-variant-numeric: tabular-nums;
		kbd {
			font: inherit;
		}
	}
	/* One hairline between groups, inset to the item text */
	.separator {
		list-style: none;
		height: 1px;
		margin: 0.25rem 1rem;
		padding: 0;
		background: var(--color-border);
	}
</style>
