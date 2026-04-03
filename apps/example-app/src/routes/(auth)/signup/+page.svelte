<script lang="ts">
	import { Button, Input, Callout } from '@delightstack/components';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function handleSignUp() {
		error = '';
		loading = true;
		try {
			const result = await fetch('/api/auth/signup/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, email, password }),
			});
			if (!result.ok) {
				const data = await result.json();
				error = data.message || 'Sign up failed';
				return;
			}
			// Create an org for the new user (the session cookie is now set)
			const orgResult = await fetch('/api/auth/org', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: `${name}'s Family` }),
			});
			if (!orgResult.ok) {
				// Account created but org failed — send to org page to finish setup
				window.location.href = '/account/org';
				return;
			}
			window.location.href = '/dashboard';
		} catch {
			error = 'An unexpected error occurred';
		} finally {
			loading = false;
		}
	}
</script>

<div class="auth-page">
	<div class="auth-card">
		<h1>Create Account</h1>
		<p class="subtitle">Start your Forever Family</p>

		{#if error}
			<Callout type="error">{error}</Callout>
		{/if}

		<form onsubmit={(e) => { e.preventDefault(); handleSignUp(); }}>
			<div class="fields">
				<Input
					label="Name"
					bind:value={name}
					required
					placeholder="Your name"
				/>
				<Input
					label="Email"
					type="email"
					bind:value={email}
					required
					placeholder="you@example.com"
				/>
				<Input
					label="Password"
					type="password"
					bind:value={password}
					required
					placeholder="Choose a password"
				/>
			</div>

			<Button type="submit" disabled={loading} fullWidth>
				{loading ? 'Creating account...' : 'Create Account'}
			</Button>
		</form>

		<div class="divider"><span>or</span></div>

		<div class="oauth-buttons">
			<Button href="/api/auth/signin/github" fullWidth transparent>
				Continue with GitHub
			</Button>
			<Button href="/api/auth/signin/google" fullWidth transparent>
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
	form {
		display: flex;
		flex-direction: column;
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
