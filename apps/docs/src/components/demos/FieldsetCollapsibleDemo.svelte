<script>
	import { Fieldset, Input, Toggle } from '@delightstack/components/form';

	let collapsed = $state(false);
</script>

<Fieldset label="Advanced Options" collapsible bind:collapsed bordered>
	<Input label="Custom Domain" name="domain" />
	<Toggle label="Enable API Access" name="api" />
</Fieldset>
