<script>
	import { CommandPalette, Button } from '@delightstack/components/actions';

	let open = $state(false);

	const commands = [
		{ id: 'new', title: 'New file', shortcut: ['Ctrl', 'N'], onselect: () => {} },
		{ id: 'open', title: 'Open file', shortcut: ['Ctrl', 'O'], onselect: () => {} },
		{ id: 'save', title: 'Save', shortcut: ['Ctrl', 'S'], onselect: () => {} },
		{ id: 'cut', title: 'Cut', shortcut: ['Ctrl', 'X'], onselect: () => {} },
		{ id: 'copy', title: 'Copy', shortcut: ['Ctrl', 'C'], onselect: () => {} },
		{ id: 'paste', title: 'Paste', shortcut: ['Ctrl', 'V'], onselect: () => {} },
	];
</script>

<Button onclick={() => (open = true)}>Open ungrouped palette</Button>

<CommandPalette bind:open {commands} group_by="none" placeholder="Search…" />
