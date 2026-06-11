<script>
	import { Fieldset, Input } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
	let name = $state('Ada Lovelace');
	let email = $state('ada@example.com');
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<Fieldset skeleton={loading} label="User Profile" bordered>
			<Input label="Name" name="name" skeleton={loading} bind:value={name} />
			<Input
				label="Email"
				name="email"
				type="email"
				skeleton={loading}
				bind:value={email} />
		</Fieldset>
	</div>
</div>

<style>
	.skeleton-demo {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
		width: 100%;
	}
</style>
