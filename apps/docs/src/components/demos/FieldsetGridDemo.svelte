<script>
	import { Fieldset, Input } from '@delightstack/components/form';
</script>

<!-- A 6-column grid lets each field take the width its content needs:
     street spans the row, city is wide, state and ZIP are short. -->
<Fieldset label="Address" grid columns={6} bordered>
	<div style:grid-column="1 / -1"><Input label="Street address" name="street" /></div>
	<div style:grid-column="span 3"><Input label="City" name="city" /></div>
	<div style:grid-column="span 1"><Input label="State" name="state" /></div>
	<div style:grid-column="span 2"><Input label="ZIP code" name="zip" /></div>
	<div style:grid-column="span 3"><Input label="Country" name="country" /></div>
</Fieldset>
