<script>
	import { Confetti } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	let celebrating = $state(false);
</script>

<div style="display: flex; align-items: center; gap: 1rem;">
	<Button onclick={() => (celebrating = true)} disabled={celebrating}>
		{celebrating ? 'Celebrating...' : 'Celebrate!'}
	</Button>
	<Confetti active={celebrating} onend={() => (celebrating = false)} />
</div>
