<script>
	import { confetti } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';
</script>

<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
	<Button onclick={() => confetti.burst()}>Burst</Button>
	<Button outline onclick={() => confetti.cannon({ duration: 3000 })}>Cannon</Button>
	<Button outline onclick={() => confetti.fireworks()}>Fireworks</Button>
	<Button outline onclick={() => confetti.sides()}>Sides</Button>
	<Button outline onclick={() => confetti.rain({ duration: 4000 })}>Rain</Button>
</div>
