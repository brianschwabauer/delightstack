<script>
	import { Tree } from '@delightstack/components/display';

	let data = $state([
		{
			id: 'documents',
			label: 'Documents',
			allowChildren: true,
			children: [
				{ id: 'report', label: 'report.pdf' },
				{ id: 'notes', label: 'notes.txt' },
			],
		},
		{
			id: 'images',
			label: 'Images',
			allowChildren: true,
			children: [
				{ id: 'photo1', label: 'photo1.png' },
				{ id: 'photo2', label: 'photo2.jpg' },
			],
		},
		{ id: 'readme', label: 'README.md' },
	]);

	let expanded = $state(['documents', 'images']);
	let lastDrop = $state('');

	function handleDrop({ node, target, position }) {
		lastDrop = `Moved "${node.label}" ${position} "${target.label}"`;
	}
</script>

<Tree {data} bind:expanded draggable ondrop={handleDrop} />

{#if lastDrop}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; opacity: 0.7;">
		{lastDrop}
	</p>
{/if}
