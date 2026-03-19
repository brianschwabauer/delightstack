<script>
	import { confetti } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';
</script>

<Button
	onclick={() =>
		confetti({
			shapes: ['star'],
			colors: ['#ffd700', '#ffb700'],
			particle_count: 80,
		})}
>
	Gold Stars
</Button>
