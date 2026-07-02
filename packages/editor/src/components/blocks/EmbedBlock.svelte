<script lang="ts">
	import type { BlockProps } from '../../types/index.js';

	type EmbedAttrs = {
		src: string;
		title: string;
		aspect_ratio: number;
		block_id: string | null;
	};

	let { attrs, editable }: BlockProps<EmbedAttrs> = $props();
</script>

<figure class="embed" style:aspect-ratio={attrs.aspect_ratio || 16 / 9}>
	<iframe
		src={attrs.src}
		title={attrs.title || 'Embedded content'}
		loading="lazy"
		allowfullscreen
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
	</iframe>
	{#if editable}
		<!-- Shield so clicks select the block instead of focusing the iframe -->
		<div class="shield" contenteditable="false"></div>
	{/if}
</figure>

<style>
	.embed {
		position: relative;
		margin: 0;
		border-radius: var(--radius, 8px);
		overflow: hidden;
		background: var(--color-bg-muted, color-mix(in oklab, currentColor 6%, transparent));

		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius, 8px) * var(--squircle-ratio, 2));
		}

		iframe {
			position: absolute;
			inset: 0;
			inline-size: 100%;
			block-size: 100%;
			border: none;
		}
	}

	.shield {
		position: absolute;
		inset: 0;
	}
</style>
