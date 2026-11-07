<script>
	import { Tree } from '@delightstack/components/display';
	import { Input } from '@delightstack/components/form';

	const fileTree = [
		{
			id: 'src',
			label: 'src',
			children: [
				{
					id: 'components',
					label: 'components',
					children: [
						{ id: 'button', label: 'Button.svelte' },
						{ id: 'modal', label: 'Modal.svelte' },
						{ id: 'table', label: 'Table.svelte' },
					],
				},
				{
					id: 'utils',
					label: 'utils',
					children: [
						{ id: 'format', label: 'format.ts' },
						{ id: 'validate', label: 'validate.ts' },
					],
				},
				{ id: 'app', label: 'app.ts' },
			],
		},
		{ id: 'package', label: 'package.json' },
		{ id: 'readme', label: 'README.md' },
	];

	let searchTerm = $state('');
</script>

<div style="max-width: 18rem; margin-bottom: 0.75rem;">
	<Input type="search" label="Filter files" dense bind:value={searchTerm} />
</div>
<Tree data={fileTree} filter={searchTerm} />
