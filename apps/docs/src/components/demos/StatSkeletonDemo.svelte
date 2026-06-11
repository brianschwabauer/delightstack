<script>
	import { Stat } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<Stat
		skeleton={loading}
		value={2451}
		label="Total Users"
		change={12.5}
		change_label="vs last month"
		size="2" />
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
