<script>
	import { Form, Input, Select } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let mode = $state('blur');
	let data = $state({ email: '' });

	const schema = {
		'~standard': {
			version: 1,
			vendor: 'demo',
			validate(value) {
				if (!value?.email || !/.+@.+\..+/.test(value.email)) {
					return { issues: [{ path: ['email'], message: 'Please enter a valid email' }] };
				}
				return { value };
			},
		},
	};

	const hints = {
		blur: 'Validates when you leave the field.',
		change: 'Validates on every keystroke as you type.',
		submit: 'Validates only when you press Submit.',
	};
</script>

<div style="display: flex; flex-direction: column; gap: 1.25rem; max-width: 360px;">
	<Select
		bind:value={mode}
		label="validate_on"
		options={[
			{ value: 'blur', label: 'blur (default)' },
			{ value: 'change', label: 'change' },
			{ value: 'submit', label: 'submit' },
		]} />

	<!-- Re-key on mode so the field's touched/error state resets cleanly when
	     you switch timing, making the difference easy to feel. -->
	{#key mode}
		<Form {data} {schema} validate_on={mode} onsubmit={() => {}}>
			<div style="display: flex; flex-direction: column; gap: 1.25rem;">
				<Input
					name="email"
					label="Email"
					type="email"
					placeholder="Type an invalid email…" />
				<Button type="submit">Submit</Button>
			</div>
		</Form>
	{/key}

	<p style="font-size: 0.8rem; color: var(--color-text-secondary);">{hints[mode]}</p>
</div>
