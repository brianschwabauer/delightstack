<script>
	import { CommandPalette, Button } from '@delightstack/components/actions';

	let open = $state(false);

	const commands = [
		{
			id: 'new',
			title: 'New file',
			category: 'File',
			shortcut: ['Mod', 'N'],
			onselect: () => {},
		},
		{
			id: 'open',
			title: 'Open file',
			category: 'File',
			shortcut: ['Mod', 'O'],
			onselect: () => {},
		},
		{
			id: 'save',
			title: 'Save',
			category: 'File',
			shortcut: ['Mod', 'S'],
			onselect: () => {},
		},
		{
			id: 'cut',
			title: 'Cut',
			category: 'Edit',
			shortcut: ['Mod', 'X'],
			onselect: () => {},
		},
		{
			id: 'copy',
			title: 'Copy',
			category: 'Edit',
			shortcut: ['Mod', 'C'],
			onselect: () => {},
		},
		{
			id: 'paste',
			title: 'Paste',
			category: 'Edit',
			shortcut: ['Mod', 'V'],
			onselect: () => {},
		},
	];
</script>

<Button onclick={() => (open = true)}>Open roomy palette</Button>

<CommandPalette bind:open {commands} comfortable placeholder="Search commands..." />
