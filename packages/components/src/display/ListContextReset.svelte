<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	import { type ListContext } from './List.svelte';

	let {
		/** Content rendered inside the reset boundary — any List within starts at nesting level 1 */
		children = undefined as undefined | Snippet,
	} = $props();

	// Reset the list nesting context so that a List rendered inside `children`
	// (e.g. inside a ListItem `menu` popover) starts at level 1 instead of
	// inheriting the parent list's level. The menu is a separate surface, not a
	// nested child of the list, so the `--level` indentation should not apply.
	// Genuine nesting (a List inside a ListItem's children) still increments
	// because it is not wrapped by this boundary.
	setContext<ListContext | undefined>('list', undefined);
</script>

{#if children}{@render children()}{/if}
