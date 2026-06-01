<script>
	import { CommandPalette, Button } from '@delightstack/components/actions';

	let open = $state(false);

	const commands = [
		{ id: 'new', title: 'New File', shortcut: ['Ctrl', 'N'], onselect: () => {} },
		{ id: 'open', title: 'Open File', shortcut: ['Ctrl', 'O'], onselect: () => {} },
		{ id: 'save', title: 'Save', shortcut: ['Ctrl', 'S'], onselect: () => {} },
		{ id: 'cut', title: 'Cut', shortcut: ['Ctrl', 'X'], onselect: () => {} },
		{ id: 'copy', title: 'Copy', shortcut: ['Ctrl', 'C'], onselect: () => {} },
		{ id: 'paste', title: 'Paste', shortcut: ['Ctrl', 'V'], onselect: () => {} },
	];
</script>

<Button onclick={() => (open = true)}>Open Ungrouped Palette</Button>

<CommandPalette bind:open {commands} group_by="none" placeholder="Search…" />
