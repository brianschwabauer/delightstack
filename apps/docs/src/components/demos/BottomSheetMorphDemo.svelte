<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
	let morphPercent = $state(0);
</script>

<Button onclick={() => (open = true)}>Open Morphing Sheet</Button>

<BottomSheet
	bind:open
	bind:morphPercent
	snapPoints={[0.32, 0.92]}
	morphRange={[0.32, 0.55]}>
	{#snippet header(morph)}
		<div class="morph-header">
			<div class="spacer"></div>
			<div class="avatar">🦊</div>
			<div class="title">Reynard Fox</div>
			<div class="tagline">Senior Forest Strategist · Online</div>
			<div class="hint">{Math.round(morph * 100)}%</div>
		</div>
	{/snippet}

	<div style="padding: 0.5rem 1.25rem 1.5rem;">
		<p style="margin: 0 0 1rem; color: color-mix(in oklch, var(--color-text), transparent 35%);">
			Drag the sheet down toward the peek height and watch the avatar shrink and the title slide
			beside it. <code>morphPercent</code> is currently <strong>{morphPercent.toFixed(2)}</strong>.
			The header just reads the <code>--morph-percent</code> CSS variable to interpolate between
			its collapsed and expanded states.
		</p>
		{#each ['Burrow', 'Woodland Trail', 'Moonlit Clearing', 'Riverbank', 'Old Oak', 'Thicket', 'Meadow Edge', 'Hollow Log'] as place, i}
			<div
				style="display: flex; justify-content: space-between; gap: 1rem; padding: 0.85rem 0; border-bottom: 1px solid var(--color-border, #2a2a2a);">
				<span>{place}</span>
				<span style="color: color-mix(in oklch, var(--color-text), transparent 45%);">
					{(i + 1) * 3} visits
				</span>
			</div>
		{/each}
		<div style="margin-top: 1rem;">
			<Button outline onclick={() => (open = false)}>Close</Button>
		</div>
	</div>
</BottomSheet>

<style>
	/* Everything interpolates between collapsed (0) and expanded (1) using the
	   --morph-percent variable the BottomSheet sets on its root. */
	.morph-header {
		--m: var(--morph-percent, 0);
		position: relative;
	}
	.spacer {
		height: calc(56px + 150px * var(--m));
	}
	.avatar {
		position: absolute;
		left: 16px;
		top: calc(8px + 14px * var(--m));
		width: calc(40px + 48px * var(--m));
		height: calc(40px + 48px * var(--m));
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: calc(20px + 22px * var(--m));
		border-radius: 9999px;
		background: linear-gradient(135deg, #f97316, #db2777);
		box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
	}
	.title {
		position: absolute;
		white-space: nowrap;
		font-weight: 600;
		left: calc(68px * (1 - var(--m)) + 16px * var(--m));
		top: calc(18px * (1 - var(--m)) + 116px * var(--m));
		font-size: calc(1.05rem + 0.45rem * var(--m));
		color: var(--color-text, inherit);
	}
	.tagline {
		position: absolute;
		left: 16px;
		top: 150px;
		font-size: 0.85rem;
		white-space: nowrap;
		color: color-mix(in oklch, var(--color-text), transparent 40%);
		/* Fade in only near full expansion, once the header has room for it. */
		opacity: clamp(0, (var(--m) - 0.8) * 5, 1);
	}
	.hint {
		position: absolute;
		right: 16px;
		top: 12px;
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
		color: color-mix(in oklch, var(--color-text), transparent 25%);
		background: color-mix(in oklch, var(--color-text), transparent 90%);
	}
</style>
