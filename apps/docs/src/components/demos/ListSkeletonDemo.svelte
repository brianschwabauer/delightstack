<script>
	import { List, ListItem } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<List skeleton={loading} skeleton_count={3}>
			<ListItem>Profile</ListItem>
			<ListItem>Settings</ListItem>
			<ListItem>Sign out</ListItem>
		</List>
	</div>
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
