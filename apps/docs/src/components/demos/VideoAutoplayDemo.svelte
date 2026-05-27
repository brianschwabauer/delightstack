<script lang="ts">
	import { Video } from '@delightstack/components';
</script>

<div class="full-width">
	<Video
		src="https://res.cloudinary.com/demo/video/upload/q_auto,w_640/dog.mp4"
		autoplay
		muted
		loop
		controls={false} />
	<p class="hint">
		Autoplay requires <code>muted</code>; browsers block autoplay-with-sound until the user
		interacts.
	</p>
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.hint {
		font-size: 0.78rem;
		color: var(--color-text-disabled, currentColor);
		text-align: center;
		margin: 0.75rem 0 0;
		opacity: 0.75;
		code {
			font-family: var(--font-mono, monospace);
			background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
			padding: 0.05rem 0.3rem;
			border-radius: 3px;
		}
	}
</style>
