<script>
	import { Expand } from '@delightstack/components/display';
	import { Checkbox, Input } from '@delightstack/components/form';

	let showAdvanced = $state(false);
	let cache_ttl = $state(3600);
	let max_retries = $state(3);
</script>

<div style="display: flex; flex-direction: column; align-items: flex-start;">
	<Checkbox bind:checked={showAdvanced} label="Show advanced options" />

	<Expand show={showAdvanced}>
		<div
			style="padding: 1rem 0; display: flex; flex-direction: column; gap: 0.75rem; width: 220px;">
			<Input type="number" label="Cache TTL (seconds)" bind:value={cache_ttl} />
			<Input type="number" label="Max retries" bind:value={max_retries} />
		</div>
	</Expand>
</div>
