<script lang="ts">
	import Panorama from '@delightstack/components/panorama';
</script>

<div class="full-width">
	<div class="frame">
		<Panorama
			src="https://pannellum.org/images/cerro-toco-0.jpg"
			auto_rotate
			auto_rotate_speed={1.5} />
	</div>
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.frame {
		aspect-ratio: 16 / 9;
		border-radius: 0.5rem;
		overflow: hidden;
		background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
	}
</style>
