<script lang="ts">
	import { Button, Input, Callout } from '@delightstack/components';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const { data } = $props();
	const { auth } = $derived(data);

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	// Redirect if already signed in
	$effect(() => {
		if (auth.signed_in) goto('/dashboard');
	});

	async function handleSignIn() {
		error = '';
		loading = true;
		try {
			const result = await fetch('/api/auth/signin/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
			});
			if (!result.ok) {
				const data = await result.json();
				error = data.message || 'Sign in failed';
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
		<h1>Welcome Back</h1>
		<p class="subtitle">Sign in to Forever Family</p>

		{#if error}
			<Callout type="error">{error}</Callout>
		{/if}

		<form onsubmit={(e) => { e.preventDefault(); handleSignIn(); }}>
			<div class="fields">
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
					placeholder="Your password"
				/>
			</div>

			<Button type="submit" disabled={loading} fullWidth>
				{loading ? 'Signing in...' : 'Sign In'}
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
			Don't have an account? <a href="/signup">Sign up</a>
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
