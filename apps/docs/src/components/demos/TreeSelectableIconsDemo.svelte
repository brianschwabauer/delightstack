<script>
	import { Tree } from '@delightstack/components/display';

	function FolderIcon() {
		return {
			render: () => {}
		};
	}

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
					],
				},
				{ id: 'app', label: 'app.ts' },
			],
		},
		{ id: 'pkg', label: 'package.json' },
		{ id: 'readme', label: 'README.md' },
	];

	let selected = $state([]);
	let expanded = $state(['src', 'components']);

	const nodeMap = new Map();
	function indexNodes(nodes) {
		for (const n of nodes) {
			nodeMap.set(n.id, n);
			if (n.children) indexNodes(n.children);
		}
	}
	indexNodes(fileTree);
</script>

<Tree
	data={fileTree}
	selectable
	multiSelect
	bind:selected
	bind:expanded
/>

{#if selected.length > 0}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; opacity: 0.7;">
		Selected: {selected.map(id => nodeMap.get(id)?.label ?? id).join(', ')}
	</p>
{/if}
