<script>
	import { Input } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
	let name = $state('');

	$effect(() => {
		const t = setTimeout(() => (loading = false), 1800);
		return () => clearTimeout(t);
	});
</script>

<div style="display: flex; flex-direction: column; gap: 0.5rem; max-width: 320px;">
	<Input
		label="Name"
		skeleton={loading}
		bind:value={name}
		placeholder="Enter your name" />
	<Button
		outline
		dense
		size="0"
		onclick={() => {
			loading = true;
			setTimeout(() => (loading = false), 1800);
		}}>
		Replay skeleton
	</Button>
</div>
