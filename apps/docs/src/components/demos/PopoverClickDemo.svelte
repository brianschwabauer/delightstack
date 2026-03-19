<script lang="ts">
	import { Popover } from '@delightstack/components/actions';

	let triggerRef = $state<HTMLElement>();
</script>

<button
	bind:this={triggerRef}
	style="
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		border: 1px solid var(--sl-color-gray-4, #666);
		background: var(--sl-color-gray-6, #1a1a1a);
		color: var(--sl-color-white, #fff);
		cursor: pointer;
		font-size: 0.9rem;
	"
>
	Toggle Popover
</button>

<Popover refElement={triggerRef} openOnClick placement="bottom-start">
	<div style="padding: 1rem; max-width: 240px;">
		<p style="margin: 0; font-size: 0.875rem; opacity: 0.8;">
			Click the button again to close.
		</p>
	</div>
</Popover>
