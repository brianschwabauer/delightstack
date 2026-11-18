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
		{
			id: 'theme',
			title: 'Toggle theme',
			category: 'View',
			description: 'Switch between light and dark mode',
			onselect: () => {},
		},
		{
			id: 'zoom-in',
			title: 'Zoom in',
			category: 'View',
			shortcut: ['Mod', '='],
			onselect: () => {},
		},
	];
</script>

<Button onclick={() => (open = true)}>Open command palette</Button>

<CommandPalette bind:open {commands} placeholder="Search commands..." />
