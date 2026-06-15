<script>
	import { Form, Input, Select, Checkbox, Fieldset } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let data = $state({ name: '', email: '', password: '', role: '', terms: false });
	let last_submit = $state('');

	// Hand-rolled Standard Schema — the docs app doesn't ship Zod, but any
	// Standard Schema validator (Zod, Valibot, ArkType) plugs in the same way.
	const schema = {
		'~standard': {
			version: 1,
			vendor: 'demo',
			validate(value) {
				const issues = [];
				if (!value?.name) issues.push({ path: ['name'], message: 'Name is required' });
				if (!value?.email || !/.+@.+\..+/.test(value.email)) {
					issues.push({ path: ['email'], message: 'Invalid email address' });
				}
				if (!value?.password || value.password.length < 8) {
					issues.push({
						path: ['password'],
						message: 'Password must be at least 8 characters',
					});
				}
				if (!value?.role)
					issues.push({ path: ['role'], message: 'Please select a role' });
				if (value?.terms !== true) {
					issues.push({ path: ['terms'], message: 'You must accept the terms' });
				}
				return issues.length ? { issues } : { value };
			},
		},
	};

	async function handleSubmit({ data }) {
		await new Promise((r) => setTimeout(r, 800));
		last_submit = JSON.stringify(data, null, 2);
	}
</script>

<Form bind:data {schema} onsubmit={handleSubmit} validate_on="blur" comfortable>
	<Fieldset label="Create Account" bordered comfortable>
		<Input name="name" label="Name" />
		<Input name="email" label="Email" type="email" />
		<Input name="password" label="Password" type="password" />
		<Select
			name="role"
			label="Role"
			placeholder="Select a role"
			options={[
				{ value: 'user', label: 'User' },
				{ value: 'admin', label: 'Admin' },
			]} />
		<Checkbox name="terms" label="I accept the terms and conditions" />
	</Fieldset>

	<div style="display: flex; gap: 1rem;">
		<Button type="reset" ghost>Reset</Button>
		<Button type="submit">Create Account</Button>
	</div>
</Form>

{#if last_submit}
	<pre
		style="margin-top: 0.75rem; font-size: 0.8rem; color: var(--color-text-secondary); white-space: pre-wrap;">Submitted: {last_submit}</pre>
{/if}
