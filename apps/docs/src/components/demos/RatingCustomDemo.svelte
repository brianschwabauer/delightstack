<script>
	import { Rating } from '@delightstack/components/form';

	let likes = $state(2);
</script>

<div style="display: flex; flex-direction: column; gap: 1rem;">
	<div>
		<p style="margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--sl-color-gray-3);">
			Custom color (error red)
		</p>
		<Rating
			bind:value={likes}
			max={3}
			color="var(--c-error, hsl(0 70% 55%))"
			show_value />
	</div>
	<div>
		<p style="margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--sl-color-gray-3);">
			Custom color (green)
		</p>
		<Rating value={4} readonly color="hsl(140 60% 45%)" show_value />
	</div>
</div>
