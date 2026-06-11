<script>
	import { AvatarGroup } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);

	const members = [
		{ name: 'Alice Johnson' },
		{ name: 'Bob Smith' },
		{ name: 'Charlie Davis' },
		{ name: 'Diana Evans' },
	];
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<AvatarGroup skeleton={loading} skeleton_count={4} avatars={loading ? [] : members} />
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
