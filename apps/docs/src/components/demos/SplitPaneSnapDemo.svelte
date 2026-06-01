<script>
	import { SplitPane } from '@delightstack/components/display';

	let size = $state(50);
</script>

<div style="height: 250px; border: 1px solid var(--sl-color-gray-5, #e5e7eb); border-radius: 0.5rem; overflow: hidden;">
	<SplitPane snap={[25, 50, 75]} snap_threshold={5} bind:size>
		{#snippet first()}
			<div style="padding: 1rem; height: 100%; background: var(--sl-color-accent-low, #eef2ff);">
				<strong>Pane A</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					Snaps at 25%, 50%, 75%. Current: {Math.round(size)}%
				</p>
			</div>
		{/snippet}
		{#snippet second()}
			<div style="padding: 1rem; height: 100%;">
				<strong>Pane B</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					Drag slowly near snap points to feel the effect.
				</p>
			</div>
		{/snippet}
	</SplitPane>
</div>
