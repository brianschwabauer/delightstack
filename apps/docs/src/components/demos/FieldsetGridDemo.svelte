<script>
	import { Fieldset, Input } from '@delightstack/components/form';
</script>

<Fieldset legend="Address" grid columns={2}>
	<Input label="Street Address" name="street" style="grid-column: 1 / -1" />
	<Input label="City" name="city" />
	<Input label="State" name="state" />
	<Input label="ZIP Code" name="zip" />
	<Input label="Country" name="country" />
</Fieldset>
