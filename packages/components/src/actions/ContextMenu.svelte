<script lang="ts" module>
	import { tick, untrack, type Component, type Snippet } from 'svelte';
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
		}>;
	}

	/** The currently displayed context mneu */
	let activeContextMenu = $state<(ContextMenuOptions & { el: HTMLElement }) | undefined>(
		undefined,
	);

	/** The X location of the context menu, used to position it */
	let contextMenuLocationX = $state<number | undefined>(undefined);

	/** The Y location of the context menu, used to position it */
	let contextMenuLocationY = $state<number | undefined>(undefined);

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
</script>

<svelte:window
	oncontextmenu={(event) => {
		let target = event.target as HTMLElement;
		while (target && !contextMenuTargets.has(target)) {
			target = target.parentElement as HTMLElement;
		}
		const contextMenu = contextMenuTargets.get(target);
		if (!contextMenu) return;
		event.preventDefault();
		activeContextMenu = undefined;
		contextMenuLocationX = event.clientX;
		contextMenuLocationY = event.clientY;
		tick().then(() => (activeContextMenu = contextMenu));
	}}
	onscroll={() => {
		if (activeContextMenu) activeContextMenu = undefined;
	}} />

<Popover
	opened={!!activeContextMenu?.actions?.length}
	strategy="fixed"
	close_on_escape_key
	close_on_outside_click
	arrow={false}
	radius="var(--radius-lg)"
	x={contextMenuLocationX}
	y={contextMenuLocationY}>
	{#if !!activeContextMenu?.actions?.length}
		<List>
			{#each activeContextMenu?.actions as action}
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
						{@render action.snippet(activeContextMenu)}
					{:else}
						{#if action.icon}
							<span
								style="display:inline-flex; align-items: center; padding-right: 0.5rem; font-size: 1.1rem;">
								<action.icon></action.icon>
							</span>
						{/if}
						{action.label}
					{/if}
				</ListItem>
			{/each}
		</List>
	{/if}
</Popover>
