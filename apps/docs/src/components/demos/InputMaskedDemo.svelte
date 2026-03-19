<script>
	import { Input } from '@delightstack/components/form';

	let phone = $state('');
	let card = $state('');
	let expiry = $state('');
</script>

<Input label="Phone" mask="(###) ###-####" bind:value={phone} />
<Input label="Card Number" mask="#### #### #### ####" bind:value={card} />
<Input label="Expiry" mask="##/##" bind:value={expiry} />
