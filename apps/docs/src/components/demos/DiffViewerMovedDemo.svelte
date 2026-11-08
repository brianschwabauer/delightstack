<script lang="ts">
	import { DiffViewer, type DiffHunk } from '@delightstack/components/display';

	// The second paragraph went to the end and was edited on the way. Two hunks
	// carry it: the stub, standing where it used to be, and the span itself.
	const moved = {
		key: 'blk-b',
		before: 'The keeper had a daughter, and she kept the light.',
		before_index: 1,
		after_index: 3,
		changed: true,
	};

	const hunks: DiffHunk[] = [
		{
			kind: 'equal',
			before: 'The lighthouse had not been lit in eleven years.',
			after: 'The lighthouse had not been lit in eleven years.',
		},
		{ kind: 'moved', ...moved, stub: true },
		{
			kind: 'equal',
			before: 'Elias set his case on the stones.',
			after: 'Elias set his case on the stones.',
		},
		{ kind: 'insert', key: 'blk-d', after: 'Nobody came down to the harbour.' },
		{
			kind: 'moved',
			...moved,
			after: 'The keeper had a daughter, and she kept the light burning.',
		},
	];
</script>

<div class="demo">
	<DiffViewer {hunks} />
</div>

<style>
	.demo {
		inline-size: 100%;
	}
</style>
