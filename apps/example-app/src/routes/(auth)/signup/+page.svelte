<script lang="ts">
	import { Button, Input, Callout, Form } from '@delightstack/components';

	const { data } = $props();
	const { auth } = $derived(data);

	let form_data = $state({ name: '', email: '', password: '' });
	let error = $state('');

	async function handleSignUp() {
		error = '';
		try {
			await auth.signUp.email(form_data);
			try {
				await auth.createOrg({ name: `${form_data.name}'s Family` });
				window.location.href = '/dashboard';
			} catch {
				// Account created but org failed — send to org page to finish setup
				window.location.href = '/account/org';
			}
		} catch (e) {
			error = (e as { message?: string })?.message || 'Sign up failed';
		}
	}
</script>

<div class="auth-page">
	<div class="auth-card">
		<h1>Create Account</h1>
		<p class="subtitle">Start your Forever Family</p>

		{#if error}
			<Callout error>{error}</Callout>
		{/if}

		<Form bind:data={form_data} onsubmit={handleSignUp}>
			<div class="fields">
				<Input
					label="Name"
					bind:value={form_data.name}
					required
					placeholder="Your name"
				/>
				<Input
					label="Email"
					type="email"
					bind:value={form_data.email}
					required
					placeholder="you@example.com"
				/>
				<Input
					label="Password"
					type="password"
					bind:value={form_data.password}
					required
					placeholder="Choose a password"
				/>
			</div>

			<Button type="submit" full_width>Create Account</Button>
		</Form>

		<div class="divider"><span>or</span></div>

		<div class="oauth-buttons">
			<Button href="/api/auth/signin/github" full_width transparent>
				Continue with GitHub
			</Button>
			<Button href="/api/auth/signin/google" full_width transparent>
				Continue with Google
			</Button>
		</div>

		<p class="footer">
			Already have an account? <a href="/signin">Sign in</a>
		</p>
	</div>
</div>

<style>
	.auth-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--size-5);
	}
	.auth-card {
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: var(--size-4);
	}
	h1 {
		font-family: var(--font-serif);
		text-align: center;
	}
	.subtitle {
		text-align: center;
		color: var(--color-text-disabled);
		margin-top: var(--size-000);
	}
	:global(form.form) {
		gap: var(--size-4);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
	}
	.divider {
		display: flex;
		align-items: center;
		gap: var(--size-3);
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
		&::before, &::after {
			content: '';
			flex: 1;
			height: 1px;
			background: var(--color-outline);
		}
	}
	.oauth-buttons {
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
	}
	.footer {
		text-align: center;
		font-size: var(--font-size-0);
		color: var(--color-text-disabled);
		a {
			color: var(--color-action);
			font-weight: var(--font-weight-6);
		}
	}
</style>
