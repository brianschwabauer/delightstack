<script>
	import { confetti } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	function celebrate() {
		confetti({
			particle_count: 100,
			spread: 70,
			origin: { x: 0.5, y: 0.6 },
			colors: ['#ff0000', '#00ff00', '#0000ff'],
		});
	}
</script>

<Button onclick={celebrate}>Custom Burst</Button>
