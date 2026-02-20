<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AuthClientError } from '../auth.client.svelte';
	import type { AuthClient } from '../auth.client.svelte';

	interface SignInState {
		email: string;
		password: string;
		is_loading: boolean;
		error: AuthClientError | null;
		magic_link_sent: boolean;
	}

	interface SignInActions {
		handleSubmit: () => Promise<void>;
		handleMagicLink: () => Promise<void>;
		handleOAuth: (vendor: string) => void;
		setEmail: (value: string) => void;
		setPassword: (value: string) => void;
	}

	interface Props {
		/** The AuthClient instance */
		auth: AuthClient;
		/** Redirect URL after sign-in */
		redirect_to?: string;
		/** Allow magic link sign-in */
		allow_magic_link?: boolean;
		/** OAuth providers to show */
		oauth_providers?: string[];
		/** Headless render snippet — receives state and actions */
		children?: Snippet<[SignInState & SignInActions]>;
		/** Callback on successful sign-in */
		onSuccess?: () => void;
		/** Callback on error */
		onError?: (error: AuthClientError) => void;
	}

	let {
		auth,
		redirect_to = '/dashboard',
		allow_magic_link = true,
		oauth_providers = [],
		children,
		onSuccess,
		onError,
	}: Props = $props();

	let email = $state('');
	let password = $state('');
	let is_loading = $state(false);
	let error = $state<AuthClientError | null>(null);
	let magic_link_sent = $state(false);

	async function handleSubmit() {
		is_loading = true;
		error = null;
		const result = await auth.api.signIn.email({ email, password });
		is_loading = false;
		if (result.ok) {
			onSuccess?.();
			window.location.href = redirect_to;
		} else {
			error = result.error;
			onError?.(result.error);
		}
	}

	async function handleMagicLink() {
		is_loading = true;
		error = null;
		const result = await auth.api.signIn.emailMagicLink({ email });
		is_loading = false;
		if (result.ok) {
			magic_link_sent = true;
		} else {
			error = result.error;
			onError?.(result.error);
		}
	}

	function handleOAuth(vendor: string) {
		auth.api.signIn.oauth(vendor, { redirect_to });
	}
</script>

{#if children}
	{@render children({
		email,
		password,
		is_loading,
		error,
		magic_link_sent,
		handleSubmit,
		handleMagicLink,
		handleOAuth,
		setEmail: (v) => (email = v),
		setPassword: (v) => (password = v),
	})}
{:else}
	<form onsubmit={handleSubmit}>
		<input type="email" bind:value={email} placeholder="Email" required />
		<input type="password" bind:value={password} placeholder="Password" />

		{#if error}
			<p class="error">{error.message}</p>
		{/if}

		<button type="submit" disabled={is_loading}>
			{is_loading ? 'Signing in...' : 'Sign In'}
		</button>

		{#if allow_magic_link}
			<button type="button" onclick={handleMagicLink} disabled={is_loading}>
				{magic_link_sent ? 'Check your email' : 'Sign in with Magic Link'}
			</button>
		{/if}

		{#each oauth_providers as provider}
			<button type="button" onclick={() => handleOAuth(provider)}>
				Continue with {provider}
			</button>
		{/each}
	</form>
{/if}
