<script>
	import { Popover } from '@delightstack/components/actions';

	let triggerEl = $state(undefined);
</script>

<div style="position:relative;display:inline-block;">
	<span
		bind:this={triggerEl}
		style="text-decoration:underline dotted;cursor:help;color:var(--color-text);font-size:0.9375rem;">
		Hover over me for info
	</span>
	<Popover refElement={triggerEl} openOnHover hoverDelay={200} strategy="absolute" arrow={false} placement="bottom-start">
		<div style="padding: 0.5rem 1rem; color: var(--color-text);">
			<p style="margin: 0; font-size: 0.875rem; opacity: 0.8;">Helpful tooltip-like information appears on hover.</p>
		</div>
	</Popover>
</div>
