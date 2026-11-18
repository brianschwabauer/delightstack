<script lang="ts" module>
	import { shortcutKeyCap } from './shortcut-keys.js';

	/** Apple platforms print ⌘ for `Mod` and glyphs for Control and Option. Same check as
	 * the editor's CommandMenu; false during SSR. */
	const IS_APPLE =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
</script>

<script lang="ts">
	// Internal: the keycaps ContextMenu and CommandPalette draw for a shortcut, so the
	// two can never drift apart. Not exported from the package.
	let {
		/** The shortcut's keys in order, e.g. `['Shift', 'Mod', 'G']` (see `shortcutKeyCap`) */
		keys = [] as string[],
	} = $props();

	const caps = $derived(keys.map((key) => shortcutKeyCap(key, IS_APPLE)));
</script>

<span class="keys">
	{#each caps as cap}
		<!-- One-character caps (letters and glyphs) share one square width, so a column of
		     single-key shortcuts lines up -->
		<kbd class:single={[...cap.text].length === 1} title={cap.name}>
			{#if cap.name}
				<span aria-hidden="true">{cap.text}</span>
				<span class="name">{cap.name}</span>
			{:else}
				{cap.text}
			{/if}
		</kbd>
	{/each}
</span>

<style>
	.keys {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	kbd {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5em;
		height: 1.5em;
		/* the font's caps sit above the line box's center: a little top padding centers them */
		padding: 0.1em 0.35em 0;
		font-family: inherit;
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background-color: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));
		/* a soft edge: the cap should read quieter than the label beside it */
		border: 1px solid oklch(from var(--color-text) l c h / 0.14);
		border-radius: var(--radius-xl);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-xl) * var(--squircle-ratio, 2));
		}
		line-height: 1;
		&.single {
			width: 1.5em;
			padding-inline: 0;
		}
	}
	/* The spelled-out name, for assistive tech; the glyph beside it is hidden from them */
	.name {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
