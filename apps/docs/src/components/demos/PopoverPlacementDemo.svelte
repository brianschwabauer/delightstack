<script>
	import { Button, Popover } from '@delightstack/components/actions';

	let triggerEl = $state(undefined);
	let opened = $state(false);
</script>

<div style="position:relative;display:inline-block;" bind:this={triggerEl}>
	<Button onclick={() => (opened = !opened)}>Show Right Popover</Button>
	<Popover refElement={triggerEl} bind:opened strategy="absolute" arrow={false} placement="right-start">
		<div style="padding: 1rem; color: var(--color-text);">
			<p style="margin: 0; font-size: 0.875rem;">No arrow, positioned to the right.</p>
		</div>
	</Popover>
</div>
