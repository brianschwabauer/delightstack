<script>
	import { Avatar } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<!-- The skeleton auto-dismisses once the avatar has something real to
	     render (a loaded image, initials from `name`, or children). -->
	<Avatar skeleton name={loading ? undefined : 'Ada Lovelace'} size="3" />
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
