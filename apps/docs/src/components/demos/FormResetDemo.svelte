<script>
	import { Form, Input } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let data = $state({ name: '', email: '' });
	let last_submit = $state('');

	const schema = {
		'~standard': {
			version: 1,
			vendor: 'demo',
			validate(value) {
				const issues = [];
				if (!value?.name) issues.push({ path: ['name'], message: 'Name is required' });
				if (!value?.email || !/.+@.+\..+/.test(value.email)) {
					issues.push({ path: ['email'], message: 'Invalid email' });
				}
				return issues.length ? { issues } : { value };
			},
		},
	};

	// reset_on_submit clears values, errors, and touched state after a
	// successful submit. A native type="reset" button does the same on demand.
	function handleSubmit({ data }) {
		last_submit = JSON.stringify(data);
	}
</script>

<Form bind:data {schema} onsubmit={handleSubmit} reset_on_submit>
	<div style="display: flex; flex-direction: column; gap: 1.25rem; max-width: 360px;">
		<Input name="name" label="Name" />
		<Input name="email" label="Email" type="email" />
		<div style="display: flex; gap: 1rem;">
			<Button type="reset" ghost>Reset</Button>
			<Button type="submit">Submit</Button>
		</div>
	</div>
</Form>

{#if last_submit}
	<p style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--color-text-secondary);">
		Submitted (then cleared): <code>{last_submit}</code>
	</p>
{/if}
