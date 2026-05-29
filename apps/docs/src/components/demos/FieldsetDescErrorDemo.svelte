<script>
	import { Fieldset, Input, Checkbox } from '@delightstack/components/form';

	let permissions = $state([]);

	function toggle(val) {
		if (permissions.includes(val)) {
			permissions = permissions.filter((v) => v !== val);
		} else {
			permissions = [...permissions, val];
		}
	}
</script>

<div style="display: flex; flex-direction: column; gap: 1.5rem; width: 100%;">
	<Fieldset label="Profile" description="This information is publicly visible" bordered>
		<Input label="Display Name" name="displayName" />
		<Input label="Bio" name="bio" />
	</Fieldset>

	<Fieldset
		label="Permissions"
		required
		error={permissions.length === 0 ? 'Select at least one permission' : ''}
		bordered
	>
		<Checkbox
			checked={permissions.includes('read')}
			onchange={() => toggle('read')}
			label="Read"
		/>
		<Checkbox
			checked={permissions.includes('write')}
			onchange={() => toggle('write')}
			label="Write"
		/>
	</Fieldset>
</div>
