<script>
	import { Progress } from '@delightstack/components/feedback';
</script>

<div style="display: flex; flex-direction: column; gap: 1rem;">
	<div>
		<p style="margin: 0 0 0.5rem; font-size: 0.875rem; font-weight: 500;">Disk Usage</p>
		<Progress
			circular={false}
			segments={[
				{ value: 40, color: 'var(--color-success, #22c55e)', label: 'Documents' },
				{ value: 25, color: 'var(--color-warning, #f59e0b)', label: 'Photos' },
				{ value: 10, color: 'var(--color-error, #ef4444)', label: 'System' },
			]}
		/>
		<div style="display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.75rem;">
			<span style="display: flex; align-items: center; gap: 0.25rem;">
				<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--color-success, #22c55e);"></span>
				Documents (40%)
			</span>
			<span style="display: flex; align-items: center; gap: 0.25rem;">
				<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--color-warning, #f59e0b);"></span>
				Photos (25%)
			</span>
			<span style="display: flex; align-items: center; gap: 0.25rem;">
				<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--color-error, #ef4444);"></span>
				System (10%)
			</span>
		</div>
	</div>
</div>
