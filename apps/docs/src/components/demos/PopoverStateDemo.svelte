<script lang="ts">
	import { Select, Toggle } from '@delightstack/components/form';
	import { Popover, type PopoverPlacement } from '@delightstack/components/actions';

	let refElement = $state<HTMLElement | undefined>(undefined);
	let opened = $state(false);
	let placement = $state<PopoverPlacement>('bottom');
	const placements: PopoverPlacement[] = [
		'top',
		'top-start',
		'top-end',
		'bottom',
		'bottom-start',
		'bottom-end',
		'left',
		'left-start',
		'left-end',
		'right',
		'right-start',
		'right-end',
	];
</script>

<div class="controls">
	<Toggle bind:checked={opened} label={opened ? 'Popover Opened' : 'Popover Closed'} />
	<Select
		options={placements.map((p) => ({ label: p, value: p }))}
		bind:value={placement} />
</div>
<div bind:this={refElement} class="ref-element">
	Popover position reference
	<p style="margin: 0; font-size: 0.875rem; opacity: 0.8;">
		Resize the container to see the popover reposition.
	</p>
</div>
<Popover
	bind:opened
	bind:refElement
	closeOnOutsideClick={false}
	closeOnEscapeKey={false}
	{placement}>
	<h2>Popover Title</h2>
	<p>Popover opened state is controlled outside the popover component.</p>
</Popover>

<style>
	.controls {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		align-items: center;
		width: 100%;
	}
	.ref-element {
		background-color: var(--color-bg-active);
		border: dashed 2px var(--color-outline);
		padding: 0.5rem 1rem;
		border-radius: 4px;
		margin: 1rem 0 0;
		resize: both;
		overflow: auto;
	}
</style>
