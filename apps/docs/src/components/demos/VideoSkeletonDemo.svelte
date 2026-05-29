<script lang="ts">
	import { Video, Button } from '@delightstack/components';

	let loading = $state(true);
</script>

<div class="full-width" style="display: flex; flex-direction: column; gap: 0.75rem;">
	<Video
		skeleton={loading}
		src="https://res.cloudinary.com/demo/video/upload/q_auto,w_640/dog.mp4" />
	<Button outline dense size="0" onclick={() => (loading = !loading)}>
		Toggle skeleton ({loading ? 'on' : 'off'})
	</Button>
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
