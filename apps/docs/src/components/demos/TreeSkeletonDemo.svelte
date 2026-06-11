<script>
	import { Tree } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
	let expanded = $state(['src', 'components']);

	const data = [
		{
			id: 'src',
			label: 'src',
			children: [
				{
					id: 'components',
					label: 'components',
					children: [
						{ id: 'button', label: 'Button.svelte' },
						{ id: 'modal', label: 'Modal.svelte' },
					],
				},
				{ id: 'app', label: 'app.ts' },
			],
		},
		{ id: 'package', label: 'package.json' },
		{ id: 'readme', label: 'README.md' },
	];
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<Tree
			skeleton={loading}
			skeleton_count={7}
			skeleton_depth={3}
			data={loading ? [] : data}
			bind:expanded />
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
