<script>
	import { Input } from '@delightstack/components/form';

	const ALL_USERS = [
		'Alice Johnson', 'Bob Smith', 'Charlie Brown', 'Diana Prince', 'Eve Martin',
		'Frank Lee', 'Grace Hopper', 'Henry Ford', 'Ivy Chen', 'Jack Daniels',
		'Karen White', 'Liam Wong', 'Mia Park', 'Noah Davis', 'Olivia Kim',
	];

	async function search(query) {
		await new Promise((r) => setTimeout(r, 250));
		const q = query.toLowerCase();
		return ALL_USERS
			.filter((n) => n.toLowerCase().includes(q))
			.map((n) => ({ value: n.toLowerCase().replace(/\s+/g, '-'), label: n }));
	}

	let selected = $state('');
</script>

<Input
	label="Search users"
	placeholder="Start typing a name…"
	onfilter={search}
	bind:value={selected} />
