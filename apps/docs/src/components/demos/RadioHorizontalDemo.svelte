<script>
	import { Radio, RadioGroup } from '@delightstack/components/form';

	let preference = $state('');
</script>

<RadioGroup bind:value={preference} horizontal name="preference" label="Preference">
	<Radio value="yes" label="Yes" />
	<Radio value="no" label="No" />
	<Radio value="maybe" label="Maybe" />
</RadioGroup>
