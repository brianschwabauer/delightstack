<script>
	import { SplitPane } from '@delightstack/components/display';
</script>

<div
	style="height: 300px; border: 1px solid var(--sl-color-gray-5, #e5e7eb); border-radius: 0.5rem; overflow: hidden;">
	<SplitPane vertical size={70}>
		{#snippet first()}
			<div
				style="padding: 1rem; height: 100%; background: var(--sl-color-gray-6, #f9fafb);">
				<strong>Editor</strong>
				<p
					style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
					Top pane takes 70% of the height.
				</p>
			</div>
		{/snippet}
		{#snippet second()}
			<div
				style="padding: 1rem; height: 100%; background: var(--sl-color-gray-7, #1e1e2e); color: var(--sl-color-gray-11, #e0e0e0);">
				<strong>Terminal</strong>
				<p style="margin-top: 0.5rem; font-size: 0.875rem;">$ pnpm run build</p>
			</div>
		{/snippet}
	</SplitPane>
</div>
