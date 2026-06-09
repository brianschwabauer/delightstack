<script>
	import { Radio, RadioGroup } from '@delightstack/components/form';

	let plan = $state('');
</script>

<RadioGroup bind:value={plan} name="plan" label="Select a plan">
	<Radio value="free" label="Free" description="Basic features, forever free" />
	<Radio value="pro" label="Pro" description="Advanced features, $10/mo" />
	<Radio value="enterprise" label="Enterprise" description="Custom pricing" />
</RadioGroup>
