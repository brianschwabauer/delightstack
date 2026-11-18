<script>
	import { CommandPalette, Button } from '@delightstack/components/actions';

	let open = $state(false);

	const commands = [
		{ id: 'new', title: 'New file', shortcut: ['Mod', 'N'], onselect: () => {} },
		{ id: 'open', title: 'Open file', shortcut: ['Mod', 'O'], onselect: () => {} },
		{ id: 'save', title: 'Save', shortcut: ['Mod', 'S'], onselect: () => {} },
		{ id: 'cut', title: 'Cut', shortcut: ['Mod', 'X'], onselect: () => {} },
		{ id: 'copy', title: 'Copy', shortcut: ['Mod', 'C'], onselect: () => {} },
		{ id: 'paste', title: 'Paste', shortcut: ['Mod', 'V'], onselect: () => {} },
	];
</script>

<Button onclick={() => (open = true)}>Open ungrouped palette</Button>

<CommandPalette bind:open {commands} group_by="none" placeholder="Search…" />
