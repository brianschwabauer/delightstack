<script>
	import { Tree } from '@delightstack/components/display';

	const categories = [
		{
			id: 'fruits',
			label: 'Fruits',
			children: [
				{ id: 'apple', label: 'Apple' },
				{ id: 'banana', label: 'Banana' },
				{ id: 'cherry', label: 'Cherry' },
			],
		},
		{
			id: 'vegetables',
			label: 'Vegetables',
			children: [
				{ id: 'carrot', label: 'Carrot' },
				{ id: 'broccoli', label: 'Broccoli' },
				{ id: 'spinach', label: 'Spinach' },
			],
		},
	];

	let selected = $state([]);
	let expanded = $state(['fruits', 'vegetables']);
</script>

<Tree
	data={categories}
	selectable
	checkboxes
	multi_select
	bind:selected
	bind:expanded
/>

{#if selected.length > 0}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; opacity: 0.7;">
		Checked: {selected.join(', ')}
	</p>
{/if}
