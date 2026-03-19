<script>
	import { Select } from '@delightstack/components/form';

	let selectedUser = $state('');

	const users = [
		{ value: 'alice', label: 'Alice Johnson', description: 'Engineering', initials: 'AJ' },
		{ value: 'bob', label: 'Bob Smith', description: 'Design', initials: 'BS' },
		{ value: 'carol', label: 'Carol Williams', description: 'Marketing', initials: 'CW' },
		{ value: 'dave', label: 'Dave Brown', description: 'Sales', initials: 'DB' },
	];
</script>

<div style="width: 280px;">
	<Select options={users} bind:value={selectedUser} label="Assign to" placeholder="Select a team member">
		{#snippet option(opt)}
			<div style="display: flex; align-items: center; gap: 0.5rem;">
				<div
					style="width: 28px; height: 28px; border-radius: 50%; background: var(--c-primary, hsl(220 70% 55%)); color: white; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 600; flex-shrink: 0;"
				>
					{opt.initials}
				</div>
				<div>
					<div style="font-size: 0.875rem;">{opt.label}</div>
					<div style="font-size: 0.75rem; opacity: 0.6;">{opt.description}</div>
				</div>
			</div>
		{/snippet}
	</Select>
</div>
