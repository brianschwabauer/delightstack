<script>
	import { Checkbox } from '@delightstack/components/form';

	let permissions = $state([]);

	function toggle(val) {
		if (permissions.includes(val)) {
			permissions = permissions.filter((v) => v !== val);
		} else {
			permissions = [...permissions, val];
		}
	}
</script>

<div>
	<p style="margin: 0 0 0.5rem; font-weight: 600;">
		Permissions <span style="color: var(--c-error, hsl(0 70% 55%));">*</span>
	</p>
	<div style="display: flex; flex-direction: column; gap: 0.25rem;">
		<Checkbox
			checked={permissions.includes('read')}
			onchange={() => toggle('read')}
			label="Read" />
		<Checkbox
			checked={permissions.includes('write')}
			onchange={() => toggle('write')}
			label="Write" />
		<Checkbox
			checked={permissions.includes('admin')}
			onchange={() => toggle('admin')}
			label="Admin" />
	</div>
	{#if permissions.length === 0}
		<p
			style="margin: 0.5rem 0 0; font-size: 0.85rem; color: var(--c-error, hsl(0 70% 55%));">
			Select at least one permission
		</p>
	{/if}
	<p style="margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--sl-color-gray-3);">
		Selected: {permissions.join(', ') || 'none'}
	</p>
</div>
