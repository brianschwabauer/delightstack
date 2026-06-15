<script>
	import { Form, Input } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let data = $state({ email: '' });
	let status = $state('');

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

	// Returning a Promise flips the form into its submitting state: every field
	// is disabled, the submit button shows a spinner, and double-submit is blocked
	// — all automatically, no manual flag needed.
	async function handleSubmit({ data }) {
		status = 'Submitting…';
		await new Promise((r) => setTimeout(r, 1500));
		status = `Saved ${data.email}`;
	}
</script>

<div>
	<Form bind:data {schema} onsubmit={handleSubmit}>
		<div style="display: flex; flex-direction: column; gap: 1.25rem; max-width: 360px;">
			<Input name="email" label="Email" type="email" />
			<Button type="submit">Submit</Button>
		</div>
	</Form>

	{#if status}
		<p
			style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--color-text-secondary);">
			{status}
		</p>
	{/if}
</div>
