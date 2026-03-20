<script>
	import { Popover } from '@delightstack/components/actions';

	let triggerEl = $state(undefined);
</script>

<div style="position:relative;display:inline-block;">
	<input
		bind:this={triggerEl}
		placeholder="Focus to see suggestions"
		style="padding:0.5rem 0.75rem;border-radius:var(--radius-2,5px);border:1px solid var(--color-border, rgba(255,255,255,0.15));background:var(--color-bg-1, #1a1a1a);color:var(--color-text, white);font-size:0.9375rem;width:250px;font-family:inherit;" />
	<Popover
		refElement={triggerEl}
		openOnFocus
		arrow={false}
		placement="bottom-start"
		disableInitialFocus>
		<div
			style="min-width: 250px; display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem;">
			<div>Suggestion 1</div>
			<div>Suggestion 2</div>
			<div>Suggestion 3</div>
		</div>
	</Popover>
</div>
