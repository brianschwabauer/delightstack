<script>
	import { Fieldset, Input, Toggle } from '@delightstack/components/form';

	let collapsed = $state(false);
</script>

<Fieldset label="Advanced options" collapsible bind:collapsed bordered>
	<Input label="Custom domain" name="domain" />
	<Toggle label="Enable API Access" name="api" />
</Fieldset>
