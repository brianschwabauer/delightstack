<script>
	import { Table } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);

	const columns = [
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'status', label: 'Status' },
	];

	const rows = [
		{ name: 'Ada Lovelace', email: 'ada@example.com', status: 'Active' },
		{ name: 'Grace Hopper', email: 'grace@example.com', status: 'Active' },
		{ name: 'Alan Turing', email: 'alan@example.com', status: 'Invited' },
		{ name: 'Katherine Johnson', email: 'katherine@example.com', status: 'Active' },
	];
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<!-- skeleton_count matches the real row count, so the swap doesn't shift. -->
		<Table skeleton={loading} skeleton_count={4} {columns} data={loading ? [] : rows} />
	</div>
</div>

<style>
	.skeleton-demo {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
		width: 100%;
	}
</style>
