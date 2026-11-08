<script lang="ts">
	import { DiffViewer } from '@delightstack/components/display';

	const before = `## Chapter one

He arrived at noon.
The town was quiet.`;

	const after = `## Chapter one — arrival

He arrived a little after noon.
The town was quiet, and the shutters were closed.`;
</script>

<div class="demo">
	<DiffViewer {before} {after} mode="side-by-side" label_before="Draft 2" label_after="Draft 3" />
</div>

<style>
	.demo {
		inline-size: 100%;
	}
</style>
