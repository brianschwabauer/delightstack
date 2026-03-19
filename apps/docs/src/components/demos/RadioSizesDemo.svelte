<script>
	import { Radio, RadioGroup } from '@delightstack/components/form';

	let val0 = $state('a');
	let val1 = $state('a');
	let val2 = $state('a');
	let val3 = $state('a');
</script>

<div style="display: flex; flex-direction: column; gap: 1.5rem;">
	<RadioGroup bind:value={val0} name="size0" size="0" label="Small (size 0)">
		<Radio value="a" label="Option A" />
		<Radio value="b" label="Option B" />
	</RadioGroup>

	<RadioGroup bind:value={val1} name="size1" size="1" label="Default (size 1)">
		<Radio value="a" label="Option A" />
		<Radio value="b" label="Option B" />
	</RadioGroup>

	<RadioGroup bind:value={val2} name="size2" size="2" label="Medium (size 2)">
		<Radio value="a" label="Option A" />
		<Radio value="b" label="Option B" />
	</RadioGroup>

	<RadioGroup bind:value={val3} name="size3" size="3" label="Large (size 3)">
		<Radio value="a" label="Option A" />
		<Radio value="b" label="Option B" />
	</RadioGroup>
</div>
