<script>
	import { Tree } from '@delightstack/components/display';

	const flatData = [
		{ id: '1', parentId: null, label: 'Root' },
		{ id: '2', parentId: '1', label: 'Child 1' },
		{ id: '3', parentId: '1', label: 'Child 2' },
		{ id: '4', parentId: '2', label: 'Grandchild 1' },
		{ id: '5', parentId: '2', label: 'Grandchild 2' },
		{ id: '6', parentId: '3', label: 'Grandchild 3' },
	];

	let selected = $state([]);
	let expanded = $state(['1', '2']);
</script>

<Tree
	data={flatData}
	selectable
	bind:selected
	bind:expanded
/>
