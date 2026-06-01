<script>
	import { Tree } from '@delightstack/components/display';

	const fileTree = [
		{
			id: 'src',
			label: 'src',
			data: { badge: '4 files' },
			children: [
				{ id: 'index', label: 'index.ts', data: { badge: 'entry' } },
				{ id: 'app', label: 'app.ts' },
				{ id: 'config', label: 'config.ts', data: { badge: 'modified' } },
				{ id: 'utils', label: 'utils.ts' },
			],
		},
		{ id: 'package', label: 'package.json', data: { badge: 'v2.0.0' } },
		{ id: 'readme', label: 'README.md' },
	];

	let expanded = $state(['src']);
</script>

{#snippet customNode({ node, level })}
	<span>{node.label}</span>
	{#if node.data?.badge}
		<span style="
			margin-left: 0.5rem;
			padding: 0.125rem 0.5rem;
			font-size: 0.7rem;
			border-radius: 9999px;
			background: color-mix(in oklch, var(--color-action-active) 15%, transparent);
			color: var(--color-action-active);
			font-weight: 500;
		">{node.data.badge}</span>
	{/if}
{/snippet}

<Tree data={fileTree} node_content={customNode} bind:expanded />
