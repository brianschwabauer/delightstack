<script>
	import { Popover } from '@delightstack/components/actions';
	import { List, ListItem } from '@delightstack/components/display';

	let opened = $state(false);
	let menuX = $state(0);
	let menuY = $state(0);

	function onContextMenu(e) {
		e.preventDefault();
		menuX = e.clientX;
		menuY = e.clientY;
		opened = true;
	}

	function close() {
		opened = false;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	oncontextmenu={onContextMenu}
	style="padding: 2rem; border: 1px dashed var(--color-border, rgba(255,255,255,0.15)); border-radius: var(--radius-3, 8px); color: var(--color-text); text-align: center; user-select: none; cursor: context-menu;">
	Right-click anywhere in this area
</div>
<Popover bind:opened x={menuX} y={menuY} strategy="fixed" arrow={false} dense>
	<div style="min-width: 160px;">
		<List dense>
			<ListItem onclick={close}>Cut</ListItem>
			<ListItem onclick={close}>Copy</ListItem>
			<ListItem onclick={close}>Paste</ListItem>
		</List>
	</div>
</Popover>
