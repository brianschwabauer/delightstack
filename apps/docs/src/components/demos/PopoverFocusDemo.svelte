<script>
	import { Popover } from '@delightstack/components/actions';
	import { Input } from '@delightstack/components/form';

	// Popover listens for `focus` on its reference, which doesn't bubble — so
	// point it at the Input's own <input> rather than a wrapper.
	let wrapper = $state(undefined);
	let triggerEl = $state(undefined);
	$effect(() => {
		triggerEl = wrapper?.querySelector('input') ?? undefined;
	});
</script>

<div style="position: relative; width: min(18rem, 100%);" bind:this={wrapper}>
	<Input label="Search" placeholder="Focus to see suggestions" />
	<Popover
		ref_element={triggerEl}
		open_on_focus
		arrow={false}
		placement="bottom-start"
		disable_initial_focus>
		<div
			style="min-width: 250px; display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem;">
			<div>Suggestion 1</div>
			<div>Suggestion 2</div>
			<div>Suggestion 3</div>
		</div>
	</Popover>
</div>
