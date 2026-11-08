<script lang="ts">
	import { DiffViewer, type DiffHunk } from '@delightstack/components/display';

	// Paired by block id upstream, so the reordered paragraph is a move rather
	// than a deletion and an unrelated insertion somewhere else.
	const hunks: DiffHunk[] = [
		{
			kind: 'moved',
			key: 'blk-b',
			before: 'The keeper had a daughter.',
			after: 'The keeper had a daughter.',
			before_index: 1,
			after_index: 0,
		},
		{
			kind: 'replace',
			key: 'blk-a',
			before: 'The lamp turned all night.',
			after: 'The lamp turned all that night.',
		},
		{ kind: 'insert', key: 'blk-c', after: 'Nobody came down to the harbour.' },
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
