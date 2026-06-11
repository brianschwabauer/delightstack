<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);

	const stats = [
		{ label: 'Total visitors', value: '48,210', change: '+12.4%' },
		{ label: 'Conversion rate', value: '3.8%', change: '+0.6%' },
		{ label: 'Avg. session', value: '4m 32s', change: '−8s' },
		{ label: 'Bounce rate', value: '41.2%', change: '−2.1%' },
	];

	const pages = [
		{ path: '/pricing', views: '12,480', trend: 'up' },
		{ path: '/docs/quick-start', views: '9,217', trend: 'up' },
		{ path: '/blog/launch-week', views: '7,903', trend: 'down' },
		{ path: '/changelog', views: '4,116', trend: 'up' },
	];
</script>

<Button onclick={() => (open = true)}>Open Wide Modal</Button>

<Modal bind:open title="Monthly Report" width="800px" height="500px">
	<div
		style="display: flex; flex-direction: column; gap: 1.5rem; color: var(--color-text);">
		<p style="margin: 0; line-height: 1.6; opacity: 0.8;">
			Traffic summary for May 2026 across all properties. This modal has a custom size of
			800×500px — wide enough for dashboard-style layouts.
		</p>

		<div
			style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem;">
			{#each stats as stat (stat.label)}
				<div
					style="display: flex; flex-direction: column; gap: 0.25rem; padding: 0.9rem 1rem; border: 1px solid rgb(from var(--color-text) r g b / 0.1); border-radius: var(--radius-lg);">
					<span style="font-size: 0.8rem; opacity: 0.7;">{stat.label}</span>
					<span style="font-size: 1.4rem; font-weight: 600;">{stat.value}</span>
					<span style="font-size: 0.8rem; opacity: 0.7;">{stat.change} vs. April</span>
				</div>
			{/each}
		</div>

		<div style="display: flex; flex-direction: column; gap: 0.25rem;">
			<h3 style="margin: 0 0 0.25rem; font-size: 0.95rem;">Top pages</h3>
			{#each pages as page (page.path)}
				<div
					style="display: flex; justify-content: space-between; gap: 1rem; padding: 0.4rem 0; border-bottom: 1px solid rgb(from var(--color-text) r g b / 0.07); font-size: 0.9rem;">
					<span style="font-family: var(--font-mono, monospace);">{page.path}</span>
					<span style="opacity: 0.75;">{page.views} views</span>
				</div>
			{/each}
		</div>
	</div>
</Modal>
