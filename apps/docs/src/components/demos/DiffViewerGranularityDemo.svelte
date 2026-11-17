<script lang="ts">
	import { DiffViewer, type DiffGranularity } from '@delightstack/components/display';
	import { ButtonGroup, Button } from '@delightstack/components/actions';

	const before = 'The colour of the harbour water at dawn.';
	const after = 'The color of the harbor water at dusk.';

	const options: DiffGranularity[] = ['word', 'char', 'line'];
	let granularity = $state<DiffGranularity>('word');
	const labels: Record<DiffGranularity, string> = {
		word: 'Words',
		char: 'Characters',
		line: 'Lines',
	};
</script>

<div class="demo">
	<ButtonGroup bind:value={granularity} dense>
		{#each options as option (option)}
			<Button value={option}>{labels[option]}</Button>
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
