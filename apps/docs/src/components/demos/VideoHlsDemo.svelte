<script lang="ts">
	import { Video } from '@delightstack/components';
</script>

<div class="full-width">
	<!-- Multi-bitrate HLS test stream. hls.js is loaded on demand only when the
	     browser can't play HLS natively. -->
	<Video src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
</style>
