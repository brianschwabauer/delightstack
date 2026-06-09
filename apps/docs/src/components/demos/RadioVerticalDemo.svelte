<script>
	import { Radio, RadioGroup } from '@delightstack/components/form';

	let size = $state('');
</script>

<RadioGroup bind:value={size} name="size" label="Size">
	<Radio value="small" label="Small" />
	<Radio value="medium" label="Medium" />
	<Radio value="large" label="Large" />
</RadioGroup>
