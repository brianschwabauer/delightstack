<script lang="ts">
	import { confetti } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	let box = $state<HTMLElement>();
</script>

<div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
	<!-- Auto-targets: the burst erupts from this button without a target -->
	<Button onclick={() => confetti.burst()}>Burst from me</Button>

	<!-- Explicit target: the burst erupts from the box, not the button -->
	<Button outline onclick={() => confetti.burst({ target: box })}>
		Burst from the box →
	</Button>

	<div
		bind:this={box}
		aria-hidden="true"
		style="width: 3rem; height: 3rem; border-radius: 0.5rem; background: linear-gradient(135deg, #ff577f, #7c5cbf);">
	</div>
</div>
