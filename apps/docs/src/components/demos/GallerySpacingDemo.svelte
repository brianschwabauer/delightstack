<script lang="ts">
	import {
		Button,
		ButtonGroup,
		Gallery,
		type GalleryRadius,
		type GallerySpacing,
	} from '@delightstack/components';
	import { demoImages } from './_gallery-images';

	let spacing = $state<GallerySpacing>('default');
	let radius = $state<GalleryRadius>('small');

	const spacings: GallerySpacing[] = ['none', 'default', 'large'];
	const radii: GalleryRadius[] = ['none', 'small', 'large'];
</script>

<div class="full-width">
	<div class="controls">
		<div class="group">
			<span class="label">spacing</span>
			<ButtonGroup>
				{#each spacings as s (s)}
					<Button
						size="0"
						transparent
						active={spacing === s}
						onclick={() => (spacing = s)}>
						{s}
					</Button>
				{/each}
			</ButtonGroup>
		</div>
		<div class="group">
			<span class="label">radius</span>
			<ButtonGroup>
				{#each radii as r (r)}
					<Button
						size="0"
						dense
						transparent
						active={radius === r}
						onclick={() => (radius = r)}>
						{r}
					</Button>
				{/each}
			</ButtonGroup>
		</div>
	</div>

	<Gallery items={demoImages} display="grid" {spacing} {radius} />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
		margin-bottom: 0.75rem;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.label {
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
		color: var(--color-text-disabled, currentColor);
	}
</style>
