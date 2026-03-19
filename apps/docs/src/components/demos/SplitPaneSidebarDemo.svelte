<script>
	import { SplitPane } from '@delightstack/components/display';

	let sidebarSize = $state(25);
</script>

<div style="height: 250px; border: 1px solid var(--sl-color-gray-5, #e5e7eb); border-radius: 0.5rem; overflow: hidden;">
	<SplitPane
		bind:size={sidebarSize}
		minSize={15}
		maxSize={40}
		snap={[25, 33]}
		collapsible
	>
		{#snippet first()}
			<div style="padding: 1rem; height: 100%; background: var(--sl-color-accent-low, #eef2ff);">
				<strong>Sidebar</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					Navigation items go here. Constrained between 15% and 40%.
				</p>
			</div>
		{/snippet}
		{#snippet second()}
			<div style="padding: 1rem; height: 100%;">
				<strong>Content</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					Main content area. Sidebar snaps at 25% and 33%.
				</p>
			</div>
		{/snippet}
	</SplitPane>
</div>
