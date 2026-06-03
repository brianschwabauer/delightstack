<script>
	import { Steps, Step } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let current = $state(1);
</script>

<Steps bind:current orientation="vertical">
	<Step title="Cart" description="Review items" />
	<Step title="Shipping" description="Enter address" />
	<Step title="Payment" description="Add payment method" />
	<Step title="Confirm" description="Place order" />
</Steps>

<div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
	<Button
		outline
		onclick={() => (current = Math.max(0, current - 1))}
		disabled={current === 0}>
		Back
	</Button>
	<Button onclick={() => (current = Math.min(4, current + 1))} disabled={current === 4}>
		Next
	</Button>
</div>
