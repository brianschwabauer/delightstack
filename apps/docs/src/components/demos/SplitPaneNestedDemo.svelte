<script>
	import { SplitPane } from '@delightstack/components/display';
</script>

<div
	style="height: 350px; border: 1px solid var(--sl-color-gray-5, #e5e7eb); border-radius: 0.5rem; overflow: hidden;">
	<SplitPane size={20} collapsible>
		{#snippet first()}
			<div
				style="padding: 1rem; height: 100%; background: var(--sl-color-accent-low, #eef2ff);">
				<strong>File Tree</strong>
				<div
					style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--sl-color-gray-2, #6b7280);">
					<div>src/</div>
					<div style="padding-left: 0.75rem;">app.ts</div>
					<div style="padding-left: 0.75rem;">index.ts</div>
					<div>lib/</div>
					<div style="padding-left: 0.75rem;">utils.ts</div>
				</div>
			</div>
		{/snippet}
		{#snippet second()}
			<SplitPane vertical size={70}>
				{#snippet first()}
					<div
						style="padding: 1rem; height: 100%; background: var(--sl-color-gray-6, #f9fafb);">
						<strong>Editor</strong>
						<pre
							style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--sl-color-gray-2, #6b7280);">function hello() &#123;
  return 'world';
&#125;</pre>
					</div>
				{/snippet}
				{#snippet second()}
					<div
						style="padding: 1rem; height: 100%; background: var(--sl-color-gray-7, #1e1e2e); color: var(--sl-color-gray-11, #e0e0e0);">
						<strong>Output</strong>
						<p style="margin-top: 0.5rem; font-size: 0.8rem;">Build succeeded in 0.42s</p>
					</div>
				{/snippet}
			</SplitPane>
		{/snippet}
	</SplitPane>
</div>
