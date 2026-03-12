<script>
	import { SplitPane } from '@delightstack/components/display';

	let size = $state(50);
</script>

<div style="height: 250px; border: 1px solid var(--sl-color-gray-5, #e5e7eb); border-radius: 0.5rem; overflow: hidden;">
	<SplitPane bind:size>
		{#snippet first()}
			<div style="padding: 1rem; height: 100%; background: var(--sl-color-gray-6, #f9fafb);">
				<strong>Left Pane</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					Drag the divider to resize.
				</p>
			</div>
		{/snippet}
		{#snippet second()}
			<div style="padding: 1rem; height: 100%;">
				<strong>Right Pane</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					Content adjusts automatically.
				</p>
			</div>
		{/snippet}
	</SplitPane>
</div>
