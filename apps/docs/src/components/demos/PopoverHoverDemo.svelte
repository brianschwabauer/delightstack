<script>
	import { Popover } from '@delightstack/components/actions';

	let triggerEl = $state(undefined);
</script>

<span bind:this={triggerEl} style="text-decoration:underline dotted;cursor:help;">
	Hover over me for info
</span>
<Popover ref_element={triggerEl} open_on_hover>
	Helpful tooltip-like information appears on hover.
</Popover>
