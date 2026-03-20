<script>
	import { Button, Popover } from '@delightstack/components/actions';

	let refElement = $state(undefined);
</script>

<Button bind:buttonElement={refElement}>Toggle Popover</Button>
<Popover {refElement} openOnClick>
	<h2>Popover Title</h2>
	<p>Positioned automatically using Floating UI.</p>
	<p>Click outside to dismiss.</p>
</Popover>
