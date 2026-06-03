<script>
	import { Steps, Step } from '@delightstack/components/navigation';

	let current = $state(0);
</script>

<Steps bind:current clickable linear={false}>
	<Step title="Overview" />
	<Step title="Details" />
	<Step title="Summary" />
</Steps>

<div
	style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--sl-color-gray-2, #ccc);">
	Current step: {current} — Click any step to jump directly to it.
</div>
