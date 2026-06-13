<script>
	import { Steps, Step } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let current = $state(2);
</script>

<!-- Constrained width so the eight steps overflow into the scroll strip -->
<div class="frame">
	<Steps bind:current clickable>
		<Step title="Account" description="Sign up" />
		<Step title="Profile" description="About you" />
		<Step title="Team" description="Invite members" />
		<Step title="Billing" description="Payment details" />
		<Step title="Plan" description="Pick a tier" />
		<Step title="Integrations" description="Connect tools" />
		<Step title="Review" description="Check settings" />
		<Step title="Launch" description="Go live" />
	</Steps>
</div>

<div class="actions">
	<Button
		outline
		onclick={() => (current = Math.max(0, current - 1))}
		disabled={current === 0}>
		Back
	</Button>
	<Button onclick={() => (current = Math.min(7, current + 1))} disabled={current === 7}>
		Next
	</Button>
</div>

<style>
	.frame {
		max-width: 28rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}
</style>
