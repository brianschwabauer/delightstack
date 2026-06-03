<script>
	import { Steps, Step } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let current = $state(0);
</script>

<Steps bind:current orientation="vertical">
	<Step title="Personal Info">
		<div style="padding: 0.75rem 0;">
			<div style="display: flex; flex-direction: column; gap: 0.5rem; max-width: 300px;">
				<input
					placeholder="Full Name"
					style="padding: 0.5rem; border: 1px solid var(--sl-color-gray-4, #666); border-radius: 0.25rem; background: transparent; color: inherit;" />
				<input
					placeholder="Email"
					style="padding: 0.5rem; border: 1px solid var(--sl-color-gray-4, #666); border-radius: 0.25rem; background: transparent; color: inherit;" />
			</div>
			<div style="margin-top: 0.75rem;">
				<Button onclick={() => current++}>Next</Button>
			</div>
		</div>
	</Step>
	<Step title="Address">
		<div style="padding: 0.75rem 0;">
			<div style="display: flex; flex-direction: column; gap: 0.5rem; max-width: 300px;">
				<input
					placeholder="Street"
					style="padding: 0.5rem; border: 1px solid var(--sl-color-gray-4, #666); border-radius: 0.25rem; background: transparent; color: inherit;" />
				<input
					placeholder="City"
					style="padding: 0.5rem; border: 1px solid var(--sl-color-gray-4, #666); border-radius: 0.25rem; background: transparent; color: inherit;" />
			</div>
			<div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
				<Button outline onclick={() => current--}>Back</Button>
				<Button onclick={() => current++}>Next</Button>
			</div>
		</div>
	</Step>
	<Step title="Confirm">
		<div style="padding: 0.75rem 0;">
			<p style="margin: 0 0 0.75rem; color: var(--sl-color-gray-2, #ccc);">
				All done! Review your information and submit.
			</p>
			<Button outline onclick={() => current--}>Back</Button>
		</div>
	</Step>
</Steps>
