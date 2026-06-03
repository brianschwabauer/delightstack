<script>
	import { Table } from '@delightstack/components/display';

	const users = [
		{
			name: 'Alice Johnson',
			email: 'alice@example.com',
			bio: 'Full-stack developer with 8 years of experience in web technologies. Passionate about clean code and user experience.',
		},
		{
			name: 'Bob Smith',
			email: 'bob@example.com',
			bio: 'DevOps engineer specializing in CI/CD pipelines and cloud infrastructure. Loves automating everything.',
		},
		{
			name: 'Carol White',
			email: 'carol@example.com',
			bio: 'Product designer who bridges the gap between design and development. Advocate for accessibility.',
		},
	];

	const columns = [
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
	];
</script>

{#snippet rowDetail(row)}
	<div
		style="padding: 0.75rem 1rem; font-size: 0.875rem; color: var(--color-text-secondary);">
		<strong>Bio:</strong>
		{row.bio}
	</div>
{/snippet}

<Table data={users} {columns} expandable expanded_row={rowDetail} />
