<script>
	import { Calendar } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
	let date = $state(undefined);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<Calendar skeleton={loading} bind:value={date} />
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
