<script>
	import { Button } from '@delightstack/components/actions';

	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	// Resolves slowly -> the spinner shows, then a success checkmark confirms it.
	async function save() {
		await wait(1500);
	}

	// Resolves almost immediately -> treated as instant, the spinner never flashes.
	async function quick() {
		await wait(60);
	}

	// Rejects -> the spinner shows, but no success checkmark is shown.
	async function failing() {
		await wait(1200);
		throw new Error('failed');
	}
</script>

<div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: start;">
	<Button accent onclick={save}>Save (1.5s)</Button>
	<Button outline onclick={quick}>Instant (60ms)</Button>
	<Button outline error onclick={failing}>Fails (no check)</Button>
</div>
