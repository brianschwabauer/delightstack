<script>
	import { CommandPalette, Button } from '@delightstack/components/actions';

	let open = $state(false);

	const commands = [
		{
			id: 'new',
			title: 'New file',
			category: 'File',
			shortcut: ['Ctrl', 'N'],
			onselect: () => {},
		},
		{
			id: 'open',
			title: 'Open file',
			category: 'File',
			shortcut: ['Ctrl', 'O'],
			onselect: () => {},
		},
		{
			id: 'save',
			title: 'Save',
			category: 'File',
			shortcut: ['Ctrl', 'S'],
			onselect: () => {},
		},
		{
			id: 'cut',
			title: 'Cut',
			category: 'Edit',
			shortcut: ['Ctrl', 'X'],
			onselect: () => {},
		},
		{
			id: 'copy',
			title: 'Copy',
			category: 'Edit',
			shortcut: ['Ctrl', 'C'],
			onselect: () => {},
		},
		{
			id: 'paste',
			title: 'Paste',
			category: 'Edit',
			shortcut: ['Ctrl', 'V'],
			onselect: () => {},
		},
	];
</script>

<Button onclick={() => (open = true)}>Open compact palette</Button>

<CommandPalette bind:open {commands} dense placeholder="Search commands..." />
