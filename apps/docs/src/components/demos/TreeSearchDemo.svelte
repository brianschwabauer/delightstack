<script>
	import { Tree } from '@delightstack/components/display';

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

<input
	bind:value={searchTerm}
	placeholder="Search nodes..."
	style="margin-bottom: 0.75rem; padding: 0.5rem 0.75rem; border: 1px solid var(--color-outline); border-radius: 0.375rem; background: var(--color-bg); color: var(--color-text); width: 100%; box-sizing: border-box;" />
<Tree data={fileTree} filter={searchTerm} />
