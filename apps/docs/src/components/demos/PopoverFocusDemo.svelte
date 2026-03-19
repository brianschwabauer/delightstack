<script>
	import { Popover } from '@delightstack/components/actions';

	let triggerEl = $state(undefined);
</script>

<div style="position:relative;display:inline-block;">
	<input
		bind:this={triggerEl}
		placeholder="Focus to see suggestions"
		style="padding:0.5rem 0.75rem;border-radius:var(--radius-2,5px);border:1px solid var(--color-border, rgba(255,255,255,0.15));background:var(--color-bg-1, #1a1a1a);color:var(--color-text, white);font-size:0.9375rem;width:250px;font-family:inherit;" />
	<Popover refElement={triggerEl} openOnFocus strategy="absolute" arrow={false} placement="bottom-start" disableInitialFocus>
		<div style="padding: 0.25rem 0; min-width: 250px; color: var(--color-text);">
			<div style="padding: 0.5rem 1rem; font-size: 0.875rem; opacity: 0.7;">Suggestion 1</div>
			<div style="padding: 0.5rem 1rem; font-size: 0.875rem; opacity: 0.7;">Suggestion 2</div>
			<div style="padding: 0.5rem 1rem; font-size: 0.875rem; opacity: 0.7;">Suggestion 3</div>
		</div>
	</Popover>
</div>
