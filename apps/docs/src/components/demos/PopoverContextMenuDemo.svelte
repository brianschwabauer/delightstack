<script>
	import { Button, Popover } from '@delightstack/components/actions';

	let triggerEl = $state(undefined);
	let opened = $state(false);
</script>

<div style="position:relative;display:inline-block;" bind:this={triggerEl}>
	<Button outline onclick={() => (opened = !opened)}>Open Menu</Button>
	<Popover refElement={triggerEl} bind:opened strategy="absolute" arrow={false} placement="bottom-start">
		<div style="padding: 0.25rem 0; min-width: 140px; color: var(--color-text);">
			<button style="display:block;width:100%;text-align:left;padding:0.375rem 1rem;border:none;background:none;color:inherit;cursor:pointer;font-size:0.875rem;font-family:inherit;" onclick={() => (opened = false)}>Cut</button>
			<button style="display:block;width:100%;text-align:left;padding:0.375rem 1rem;border:none;background:none;color:inherit;cursor:pointer;font-size:0.875rem;font-family:inherit;" onclick={() => (opened = false)}>Copy</button>
			<button style="display:block;width:100%;text-align:left;padding:0.375rem 1rem;border:none;background:none;color:inherit;cursor:pointer;font-size:0.875rem;font-family:inherit;" onclick={() => (opened = false)}>Paste</button>
		</div>
	</Popover>
</div>
