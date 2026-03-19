<script>
	import { Steps, Step } from '@delightstack/components/navigation';

	let current = $state(1);
</script>

<Steps bind:current clickable>
	<Step title="Account" />
	<Step title="Profile" />
	<Step title="Review" />
	<Step title="Complete" />
</Steps>

<div style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--sl-color-gray-2, #ccc);">
	Current step: {current} — Click any completed step to go back.
</div>
