<script>
	import { Tabs } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
	let tab = $state(0);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<!-- A reserved-height content area sits below the tabs in both states, so
	     toggling skeleton ↔ loaded swaps placeholders for real tabs in place with
	     no layout shift. -->
	<div style="width: 100%;">
		<Tabs
			skeleton={loading}
			skeleton_count={3}
			bind:tab
			tabs={[{ label: 'Overview' }, { label: 'Features' }, { label: 'Pricing' }]} />
		<div class="content-area">
			{#if !loading}
				<p style="margin: 0;">
					{['The overview panel.', 'The features panel.', 'The pricing panel.'][tab]}
				</p>
			{/if}
		</div>
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

	/* Mirror the panel's padding and reserve one line so the area is the same
	   height whether or not the content has loaded — no shift on toggle. */
	.content-area {
		padding: 1.1em 0;
		min-height: calc(1lh + 2.2em);
		box-sizing: border-box;
	}
</style>
