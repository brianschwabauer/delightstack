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

{#snippet nodeContent({ node, level })}
	<span style="display:flex;align-items:center;gap:0.375rem;flex:1;min-width:0;">
		{#if node.children && node.children.length > 0}
			<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="flex-shrink:0;opacity:0.7;">
				<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
			</svg>
		{:else}
			<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" style="flex-shrink:0;opacity:0.5;">
				<path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
			</svg>
		{/if}
		<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{node.label}</span>
	</span>
{/snippet}

<Tree
	data={fileTree}
	selectable
	multiSelect
	bind:selected
	bind:expanded
	{nodeContent}
/>

{#if selected.length > 0}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; opacity: 0.7;">
		Selected: {selected.map((id) => nodeMap.get(id)?.label ?? id).join(', ')}
	</p>
{/if}
