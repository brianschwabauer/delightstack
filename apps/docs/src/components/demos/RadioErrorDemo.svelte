<script>
	import { Radio, RadioGroup } from '@delightstack/components/form';

	let agreement = $state('');
</script>

<RadioGroup
	bind:value={agreement}
	required
	error={!agreement ? 'Please select an option' : ''}
	name="agreement"
	label="Agreement">
	<Radio value="agree" label="I agree" />
	<Radio value="disagree" label="I disagree" />
</RadioGroup>
