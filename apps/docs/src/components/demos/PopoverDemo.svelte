<script>
	import { Button, Popover } from '@delightstack/components/actions';

	let triggerEl = $state(undefined);
	let opened = $state(false);
</script>

<div style="position:relative;display:inline-block;" bind:this={triggerEl}>
	<Button onclick={() => (opened = !opened)}>
		{opened ? 'Close Popover' : 'Click for Popover'}
	</Button>
	<Popover refElement={triggerEl} bind:opened strategy="absolute" arrow={false} placement="bottom-start">
		<div style="padding: 0.75rem 1rem; max-width: 240px; color: var(--color-text);">
			<p style="margin: 0 0 0.5rem; font-weight: 600;">Popover Title</p>
			<p style="margin: 0; font-size: 0.875rem; opacity: 0.8;">
				Positioned below the trigger. Click the button again to close.
			</p>
		</div>
	</Popover>
</div>
