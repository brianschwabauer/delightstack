<script>
	import { Form, Input } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let data = $state({ name: '', age: '' });
	let last_submit = $state('');

	// Hand-rolled Standard Schema standing in for a Valibot schema — the shape
	// is the same regardless of which Standard Schema library you reach for.
	const schema = {
		'~standard': {
			version: 1,
			vendor: 'demo',
			validate(value) {
				const issues = [];
				if (!value?.name || value.name.length < 2) {
					issues.push({ path: ['name'], message: 'At least 2 characters' });
				}
				const age = Number(value?.age);
				if (!Number.isFinite(age) || age < 18) {
					issues.push({ path: ['age'], message: 'Must be 18+' });
				}
				return issues.length ? { issues } : { value };
			},
		},
	};

	async function handleSubmit({ data }) {
		await new Promise((r) => setTimeout(r, 600));
		last_submit = JSON.stringify(data);
	}
</script>

<Form bind:data {schema} onsubmit={handleSubmit}>
	<div style="display: flex; flex-direction: column; gap: 1.25rem; max-width: 360px;">
		<Input name="name" label="Name" />
		<Input name="age" label="Age" type="number" />
		<Button type="submit">Submit</Button>
	</div>
</Form>

{#if last_submit}
	<p style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--color-text-secondary);">
		Submitted: <code>{last_submit}</code>
	</p>
{/if}
