<script lang="ts">
	import { Video, Button } from '@delightstack/components';

	const VIDEO_SRC = 'https://res.cloudinary.com/demo/video/upload/q_auto,w_640/dog.mp4';

	// Simulate an async source: no `src` yet → skeleton shows; once the source
	// arrives the skeleton disappears on its own (providing a src disables it).
	let src = $state('');
	let loading = $state(true);

	function load() {
		src = VIDEO_SRC;
		loading = false;
	}

	function reset() {
		src = '';
		loading = true;
	}
</script>

<div class="full-width" style="display: flex; flex-direction: column; gap: 0.75rem;">
	<Video {src} skeleton={loading} />
	{#if loading}
		<Button outline dense size="0" onclick={load}>Load video</Button>
	{:else}
		<Button outline dense size="0" onclick={reset}>Reset to skeleton</Button>
	{/if}
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
