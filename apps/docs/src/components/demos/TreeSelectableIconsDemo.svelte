<script>
	import { Tree } from '@delightstack/components/display';

	const fileTree = [
		{
			id: '1',
			label: 'src',
			children: [
				{
					id: '1-1',
					label: 'components',
					children: [
						{ id: '1-1-1', label: 'Button.svelte' },
						{ id: '1-1-2', label: 'Modal.svelte' },
					],
				},
				{ id: '1-2', label: 'app.ts' },
			],
		},
		{ id: '2', label: 'package.json' },
	];

	let selected = $state([]);
	let expanded = $state(['1']);
</script>

<Tree
	data={fileTree}
	selectable
	bind:selected
	bind:expanded
/>

{#if selected.length > 0}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
		Selected: {selected.join(', ')}
	</p>
{/if}
