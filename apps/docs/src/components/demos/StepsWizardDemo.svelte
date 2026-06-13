<script>
	import { Steps, Step } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';
	import { Input } from '@delightstack/components/form';

	let current = $state(0);
</script>

<Steps bind:current orientation="vertical">
	<Step title="Personal Info">
		<div class="fields">
			<Input label="Full Name" />
			<Input label="Email" type="email" />
		</div>
		<div class="actions">
			<Button onclick={() => current++}>Next</Button>
		</div>
	</Step>
	<Step title="Address">
		<div class="fields">
			<Input label="Street" />
			<Input label="City" />
		</div>
		<div class="actions">
			<Button outline onclick={() => current--}>Back</Button>
			<Button onclick={() => current++}>Next</Button>
		</div>
	</Step>
	<Step title="Confirm">
		<p>All done! Review your information and submit.</p>
		<div class="actions">
			<Button outline onclick={() => current--}>Back</Button>
		</div>
	</Step>
</Steps>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 300px;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	p {
		margin: 0;
		color: var(--sl-color-gray-2, #ccc);
	}
</style>
