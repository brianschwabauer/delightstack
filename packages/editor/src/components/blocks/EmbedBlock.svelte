<script lang="ts">
	import type { BlockProps } from '../../types/index.js';
	import { icons } from '../../core/icons.js';

	type EmbedAttrs = {
		src: string;
		title: string;
		aspect_ratio: number;
		block_id: string | null;
	};

	let { attrs, editable, open_settings }: BlockProps<EmbedAttrs> = $props();

	// Only load real http(s) URLs. An empty src would resolve to the current
	// page (the app recursively embedding itself); javascript:/data: URLs are
	// rejected outright.
	const safe_src = $derived.by(() => {
		if (!attrs.src) return null;
		try {
			const url = new URL(attrs.src);
			return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
		} catch {
			return null;
		}
	});

	const provider = $derived.by(() => {
		if (!safe_src) return '';
		try {
			return new URL(safe_src).hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
	});

	// Read-only pages render a lightweight facade and only mount the iframe
	// on click — a post with five YouTube embeds must not boot five players
	// on page load. Editable mode keeps the live iframe (behind the shield)
	// so authors see what they embedded.
	let activated = $state(false);
	const show_iframe = $derived(Boolean(safe_src) && (editable || activated));
</script>

<figure class="embed" style:aspect-ratio={attrs.aspect_ratio || 16 / 9}>
	{#if show_iframe}
		<iframe
			src={safe_src}
			title={attrs.title || 'Embedded content'}
			loading="lazy"
			allowfullscreen
			sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
			allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
		</iframe>
		{#if editable}
			<!-- Shield so clicks select the block instead of focusing the iframe -->
			<div class="shield" contenteditable="false"></div>
		{/if}
	{:else if safe_src}
		<button
			type="button"
			class="facade"
			onclick={() => (activated = true)}
			aria-label="Load embedded content{attrs.title ? `: ${attrs.title}` : ''}">
			<span class="play">{@html icons.play}</span>
			<span class="facade-title">{attrs.title || 'Embedded content'}</span>
			{#if provider}
				<span class="hint">{provider}</span>
			{/if}
		</button>
	{:else}
		<div class="placeholder" contenteditable="false">
			<span class="icon">{@html icons.embed}</span>
			{#if attrs.src}
				<span>This URL can’t be embedded</span>
				<span class="hint">{attrs.src}</span>
			{:else if editable}
				<button type="button" class="prompt" onclick={() => open_settings()}>
					Add a URL to embed
				</button>
				<span class="hint">YouTube, Vimeo, Spotify, CodePen, or any page</span>
			{:else}
				<span>Empty embed</span>
			{/if}
		</div>
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

	.facade {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		border: none;
		background: none;
		font: inherit;
		color: var(--color-text-muted);
		cursor: pointer;

		&:hover .play,
		&:focus-visible .play {
			scale: 1.08;
			background: var(--action, var(--color-primary));
			color: white;
		}

		&:focus-visible {
			outline: 2px solid var(--action, var(--color-primary));
			outline-offset: -2px;
		}
	}

	.play {
		display: grid;
		place-items: center;
		inline-size: 3.5rem;
		block-size: 3.5rem;
		border-radius: 50%;
		background: var(--color-surface, Canvas);
		box-shadow: var(--shadow-md, 0 2px 8px rgb(0 0 0 / 15%));
		color: var(--color-text);
		transition:
			scale var(--duration-normal, 200ms) var(--ease-spring, ease),
			background-color var(--duration-fast, 100ms) var(--ease-out, ease),
			color var(--duration-fast, 100ms) var(--ease-out, ease);

		:global(svg) {
			inline-size: 1.5rem;
			block-size: 1.5rem;
		}
	}

	.facade-title {
		font-size: 0.875rem;
		color: var(--color-text);
		max-inline-size: 80%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.shield {
		position: absolute;
		inset: 0;
	}

	.placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		color: var(--color-text-muted);
		font-size: 0.875rem;
	}

	.icon {
		inline-size: 1.75rem;
		block-size: 1.75rem;
		opacity: 0.6;

		:global(svg) {
			inline-size: 100%;
			block-size: 100%;
		}
	}

	.prompt {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: var(--action, var(--color-primary));
		cursor: pointer;

		&:hover {
			text-decoration: underline;
		}
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-text-disabled, color-mix(in oklab, currentColor 45%, transparent));
		max-inline-size: 80%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
