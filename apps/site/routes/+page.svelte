<script lang="ts">
	import { Expand } from '@delightstack/components';
	import { ripple } from '@delightstack/utilities';

	// let color = $state('red');
	// $effect(() => {
	// 	const interval = setInterval(() => {
	// 		color = color === 'red' ? 'blue' : 'red';
	// 	}, 1000);
	// 	return () => clearInterval(interval);
	// });
</script>

<h1 {@attach ripple({ color: 'red' })}>Delight Stack</h1>

<Expand show={true}>Hello</Expand>
