<script>
	import { CommandPalette, Button } from '@delightstack/components/actions';

	let open = $state(false);

	const commands = [
		{
			id: 'new',
			title: 'New File',
			category: 'File',
			shortcut: ['Ctrl', 'N'],
			onselect: () => {},
		},
		{
			id: 'open',
			title: 'Open File',
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
		{
			id: 'theme',
			title: 'Toggle Theme',
			category: 'View',
			description: 'Switch between light and dark mode',
			onselect: () => {},
		},
		{
			id: 'zoom-in',
			title: 'Zoom In',
			category: 'View',
			shortcut: ['Ctrl', '='],
			onselect: () => {},
		},
	];
</script>

<Button onclick={() => (open = true)}>Open Command Palette</Button>

<CommandPalette bind:open {commands} placeholder="Search commands..." />
