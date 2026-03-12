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
	Click for Popover
</button>

<Popover refElement={triggerRef} openOnClick placement="bottom">
	<div style="padding: 0.75rem 1rem; max-width: 240px;">
		<p style="margin: 0 0 0.5rem; font-weight: 600;">Popover Title</p>
		<p style="margin: 0; font-size: 0.875rem; opacity: 0.8;">
			This popover is positioned automatically using Floating UI.
			Click outside to dismiss.
		</p>
	</div>
</Popover>
