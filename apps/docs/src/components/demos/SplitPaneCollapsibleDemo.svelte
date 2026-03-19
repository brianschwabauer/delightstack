<script>
	import { SplitPane } from '@delightstack/components/display';

	let collapsed = $state(null);
</script>

<div style="height: 250px; border: 1px solid var(--sl-color-gray-5, #e5e7eb); border-radius: 0.5rem; overflow: hidden;">
	<SplitPane collapsible bind:collapsed>
		{#snippet first()}
			<div style="padding: 1rem; height: 100%; background: var(--sl-color-accent-low, #eef2ff);">
				<strong>First Pane</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					Double-click divider to collapse.
				</p>
			</div>
		{/snippet}
		{#snippet second()}
			<div style="padding: 1rem; height: 100%;">
				<strong>Second Pane</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					{collapsed ? `"${collapsed}" pane is collapsed` : 'No pane collapsed'}
				</p>
			</div>
		{/snippet}
	</SplitPane>
</div>
