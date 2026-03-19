<script>
	import { Checkbox } from '@delightstack/components/form';

	let items = $state([
		{ label: 'Read', checked: true },
		{ label: 'Write', checked: false },
		{ label: 'Execute', checked: false },
	]);

	let allChecked = $derived(items.every((i) => i.checked));
	let someChecked = $derived(items.some((i) => i.checked));

	function handleParentToggle() {
		const newState = !allChecked;
		items = items.map((i) => ({ ...i, checked: newState }));
	}
</script>

<div style="display: flex; flex-direction: column; gap: 0.25rem;">
	<Checkbox
		checked={allChecked || someChecked}
		indeterminate={someChecked && !allChecked}
		onchange={handleParentToggle}
		label="Select all permissions"
	/>
	<div style="margin-left: 1.5rem; display: flex; flex-direction: column; gap: 0.25rem;">
		{#each items as item}
			<Checkbox bind:checked={item.checked} label={item.label} />
		{/each}
	</div>
</div>
