<script>
	import { Form, Input, Toggle } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let data = $state({ email: '', password: '', remember: false });
	let last_submit = $state('');

	function basicSchema() {
		// Lightweight schema-shape — Standard Schema compatible enough for demo.
		return {
			'~standard': {
				version: 1,
				vendor: 'demo',
				validate(value) {
					const issues = [];
					if (!value?.email || !/.+@.+\..+/.test(value.email)) {
						issues.push({ path: ['email'], message: 'Please enter a valid email' });
					}
					if (!value?.password || value.password.length < 8) {
						issues.push({ path: ['password'], message: 'At least 8 characters' });
					}
					return issues.length ? { issues } : { value };
				},
			},
		};
	}

	const schema = basicSchema();

	async function handleSubmit({ data }) {
		await new Promise((r) => setTimeout(r, 800));
		last_submit = JSON.stringify(data);
	}
</script>

<Form bind:data {schema} onsubmit={handleSubmit} validate_on="blur">
	<div style="display: flex; flex-direction: column; gap: 1rem; max-width: 360px;">
		<Input name="email" label="Email" type="email" />
		<Input name="password" label="Password" type="password" />
		<Toggle name="remember" label="Remember me" />
		<Button type="submit">Sign In</Button>
	</div>
</Form>

{#if last_submit}
	<p style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--color-text-secondary);">
		Submitted: <code>{last_submit}</code>
	</p>
{/if}
