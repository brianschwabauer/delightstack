<script>
	import { Breadcrumbs } from '@delightstack/components/navigation';

	const items = [
		{ label: 'Shop', href: '#shop' },
		{ label: 'Audio', href: '#audio' },
		{ label: 'Headsets', href: '#headsets' },
		{ label: 'Wireless', href: '#wireless' },
		{ label: 'Pro X2' },
	];
</script>

<div class="auto-collapse-demo">
	<p class="hint">
		Drag the right edge ↔ to resize. Items fold into the “…” menu to fit.
	</p>
	<div class="resizable">
		<Breadcrumbs {items} home_href="#" />
	</div>
</div>

<style>
	.auto-collapse-demo {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}
	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--sl-color-gray-3);
	}
	.resizable {
		resize: horizontal;
		overflow: auto;
		min-width: 12rem;
		max-width: 100%;
		width: 30rem;
		padding: 0.75rem 1rem;
		border: 1px dashed var(--sl-color-gray-4, #888);
		border-radius: 0.5rem;
	}
</style>
