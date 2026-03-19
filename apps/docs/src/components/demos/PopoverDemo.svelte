<script>
	import { Popover } from '@delightstack/components/actions';

	let triggerEl = $state(undefined);
	let opened = $state(false);

	function toggle() {
		opened = !opened;
	}
</script>

<div style="position:relative;">
	<button bind:this={triggerEl} onclick={toggle} style="padding:0.75em 1.5em;border-radius:10px;border:none;background:var(--color-action,#2563eb);color:white;cursor:pointer;font-size:inherit;font-family:inherit;">
		{opened ? 'Close Popover' : 'Click for Popover'}
	</button>
	{#if opened}
		<div style="position:absolute;top:100%;left:0;margin-top:4px;padding:0.75rem 1rem;max-width:240px;background:var(--color-bg-2,#1e1e2e);border:1px solid var(--color-border,rgba(255,255,255,0.1));border-radius:10px;color:var(--color-text,white);box-shadow:var(--shadow-3,0 4px 12px rgba(0,0,0,0.3));z-index:10;">
			<p style="margin:0 0 0.5rem;font-weight:600;">Popover Title</p>
			<p style="margin:0;font-size:0.875rem;opacity:0.8;">
				Positioned below the trigger. Click the button again to close.
			</p>
		</div>
	{/if}
</div>
