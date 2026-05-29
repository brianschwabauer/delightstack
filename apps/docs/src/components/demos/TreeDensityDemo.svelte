<script>
	import { Tree } from '@delightstack/components/display';

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
				{ id: 'index', label: 'index.ts' },
			],
		},
		{ id: 'package', label: 'package.json' },
		{ id: 'readme', label: 'README.md' },
	];

	let denseExpanded = $state(['src', 'components']);
	let comfortableExpanded = $state(['src', 'components']);
</script>

<div class="density-grid">
	<div class="density-col">
		<span class="density-label">Dense</span>
		<Tree {data} bind:expanded={denseExpanded} dense showLines />
	</div>
	<div class="density-col">
		<span class="density-label">Comfortable</span>
		<Tree {data} bind:expanded={comfortableExpanded} comfortable showLines />
	</div>
</div>

<style>
	.density-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 2rem;
		width: 100%;
	}
	.density-col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.density-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-light, hsl(0 0% 45%));
	}
</style>
