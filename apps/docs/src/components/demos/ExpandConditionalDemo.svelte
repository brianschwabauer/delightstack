<script>
	import { Expand } from '@delightstack/components/display';

	let showAdvanced = $state(false);
</script>

<label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
	<input type="checkbox" bind:checked={showAdvanced} />
	Show advanced options
</label>

<Expand show={showAdvanced}>
	<div style="padding: 1rem 0; display: flex; flex-direction: column; gap: 0.75rem;">
		<label style="display: flex; flex-direction: column; gap: 0.25rem;">
			<span style="font-size: 0.875rem; font-weight: 500;">Cache TTL (seconds)</span>
			<input type="number" value="3600" style="padding: 0.375rem 0.5rem; border: 1px solid #ccc; border-radius: 4px; width: 120px;" />
		</label>
		<label style="display: flex; flex-direction: column; gap: 0.25rem;">
			<span style="font-size: 0.875rem; font-weight: 500;">Max retries</span>
			<input type="number" value="3" style="padding: 0.375rem 0.5rem; border: 1px solid #ccc; border-radius: 4px; width: 120px;" />
		</label>
	</div>
</Expand>
