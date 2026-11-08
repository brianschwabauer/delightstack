<script lang="ts">
	import { DiffViewer, type DiffGranularity } from '@delightstack/components/display';
	import { ButtonGroup, Button } from '@delightstack/components/actions';

	const before = 'The colour of the harbour water at dawn.';
	const after = 'The color of the harbor water at dusk.';

	const options: DiffGranularity[] = ['word', 'char', 'line'];
	let granularity = $state<DiffGranularity>('word');
</script>

<div class="demo">
	<ButtonGroup>
		{#each options as option (option)}
			<Button
				outline={granularity !== option}
				onclick={() => (granularity = option)}>
				{option}
			</Button>
		{/each}
	</ButtonGroup>

	<DiffViewer {before} {after} {granularity} show_line_numbers={false} />
</div>

<style>
	.demo {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		inline-size: 100%;
	}
</style>
