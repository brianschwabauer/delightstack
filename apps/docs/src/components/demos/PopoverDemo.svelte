<script>
	import { Button, Popover } from '@delightstack/components/actions';

	let refElement = $state(undefined);
</script>

<Button bind:button_element={refElement}>Toggle Popover</Button>
<Popover ref_element={refElement} open_on_click>
	<h2>Popover Title</h2>
	<p>Positioned automatically using Floating UI.</p>
	<p>Click outside to dismiss.</p>
</Popover>
