<script>
	import { Tree } from '@delightstack/components/display';

	const data = [
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
				{ id: 'index', label: 'index.ts' },
			],
		},
		{ id: 'package', label: 'package.json' },
		{ id: 'tsconfig', label: 'tsconfig.json' },
		{ id: 'readme', label: 'README.md' },
	];

	let expanded = $state(['src', 'components']);
</script>

<Tree {data} bind:expanded showLines />
