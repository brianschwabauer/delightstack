<script>
	import { Select } from '@delightstack/components/form';

	const ALL = [
		'Alice Johnson',
		'Bob Smith',
		'Charlie Brown',
		'Diana Prince',
		'Eve Martin',
		'Frank Lee',
		'Grace Hopper',
		'Henry Ford',
		'Ivy Chen',
		'Jack Daniels',
	];

	let selected = $state('');
	let options = $state([]);
	let isLoading = $state(false);
	let timer;

	function handleSearch({ query }) {
		clearTimeout(timer);
		isLoading = true;
		timer = setTimeout(() => {
			const q = (query || '').toLowerCase();
			options = ALL.filter((n) => n.toLowerCase().includes(q)).map((n) => ({
				value: n.toLowerCase().replace(/\s+/g, '-'),
				label: n,
			}));
			isLoading = false;
		}, 400);
	}
</script>

<Select
	searchable
	loading={isLoading}
	onsearch={handleSearch}
	bind:value={selected}
	{options}
	label="Search users" />
