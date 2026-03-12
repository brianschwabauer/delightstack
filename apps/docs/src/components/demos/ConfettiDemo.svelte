<script>
	import { confetti } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';
</script>

<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
	<Button onclick={() => confetti()}>Burst</Button>
	<Button outline onclick={() => confetti.fireworks()}>Fireworks</Button>
	<Button outline onclick={() => confetti.sides()}>Sides</Button>
</div>
