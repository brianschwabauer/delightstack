<script>
	import { Tree } from '@delightstack/components/display';

	const rootNodes = [
		{
			id: 'team-a',
			label: 'Team Alpha',
			children: [],
		},
		{
			id: 'team-b',
			label: 'Team Beta',
			children: [],
		},
		{
			id: 'team-c',
			label: 'Team Gamma',
			children: [],
		},
	];

	async function loadChildren(node) {
		await new Promise((resolve) => setTimeout(resolve, 1200));
		return [
			{ id: `${node.id}-1`, label: `${node.label} - Member 1` },
			{ id: `${node.id}-2`, label: `${node.label} - Member 2` },
			{ id: `${node.id}-3`, label: `${node.label} - Member 3` },
		];
	}
</script>

<Tree data={rootNodes} {loadChildren} />
