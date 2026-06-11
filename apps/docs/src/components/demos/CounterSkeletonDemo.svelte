<script>
	import { Counter } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<!-- The shimmer pill shows while `value` is still null/undefined; the
	     count-up starts the moment the value arrives. -->
	<span style="font-size: 2.25rem; font-weight: 700;">
		<Counter skeleton value={loading ? undefined : 12845} />
	</span>
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
