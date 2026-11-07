<script>
	import { Input } from '@delightstack/components/form';

	let phone = $state('');
	let card = $state('');
	let expiry = $state('');
</script>

<!-- Each field is as wide as what it holds: a 5-character expiry gets a
     5-character box. -->
<div class="fields">
	<div style:width="11rem">
		<Input label="Phone" mask="(###) ###-####" bind:value={phone} />
	</div>
	<div class="row">
		<div style:width="15rem">
			<Input label="Card number" mask="#### #### #### ####" bind:value={card} />
		</div>
		<div style:width="6.5rem">
			<Input label="Expiry" mask="##/##" bind:value={expiry} />
		</div>
	</div>
</div>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
</style>
