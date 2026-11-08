<script lang="ts">
	import { DiffViewer } from '@delightstack/components/display';

	const middle = Array.from({ length: 14 }, (_, i) => `Unchanged line ${i + 1}`).join('\n');
	const before = `First line, as it was.\n${middle}\nLast line, as it was.`;
	const after = `First line, rewritten.\n${middle}\nLast line, rewritten.`;
</script>

<div class="demo">
	<DiffViewer {before} {after} context_lines={2} />
</div>

<style>
	.demo {
		inline-size: 100%;
	}
</style>
