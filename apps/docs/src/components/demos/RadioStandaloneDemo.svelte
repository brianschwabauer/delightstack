<script>
	import { Radio } from '@delightstack/components/form';

	let selected = $state('option1');
</script>

<div style="display: flex; flex-direction: column; gap: 0.25rem;">
	<Radio
		value="option1"
		checked={selected === 'option1'}
		onchange={() => (selected = 'option1')}
		label="Option 1"
	/>
	<Radio
		value="option2"
		checked={selected === 'option2'}
		onchange={() => (selected = 'option2')}
		label="Option 2"
	/>
	<p style="margin: 0.5rem 0 0; font-size: 0.85rem; color: var(--sl-color-gray-3);">
		Selected: {selected}
	</p>
</div>
