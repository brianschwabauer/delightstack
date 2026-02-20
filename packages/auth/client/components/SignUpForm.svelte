<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AuthClientError } from '../auth.client.svelte';
	import type { AuthClient } from '../auth.client.svelte';

	interface SignUpState {
		name: string;
		email: string;
		password: string;
		is_loading: boolean;
		error: AuthClientError | null;
	}

	interface SignUpActions {
		handleSubmit: () => Promise<void>;
		handleOAuth: (vendor: string) => void;
		setName: (value: string) => void;
		setEmail: (value: string) => void;
		setPassword: (value: string) => void;
	}

	interface Props {
		/** The AuthClient instance */
		auth: AuthClient;
		/** Redirect URL after sign-up */
		redirect_to?: string;
		/** Whether password is required */
		require_password?: boolean;
		/** OAuth providers to show */
		oauth_providers?: string[];
		/** Organization name for sign-up */
		org_name?: string;
		/** Invitation ID for joining an org */
		invitation_id?: string;
		/** Headless render snippet — receives state and actions */
		children?: Snippet<[SignUpState & SignUpActions]>;
		/** Callback on successful sign-up */
		onSuccess?: () => void;
		/** Callback on error */
		onError?: (error: AuthClientError) => void;
	}

	let {
		auth,
		redirect_to = '/dashboard',
		require_password = false,
		oauth_providers = [],
		org_name,
		invitation_id,
		children,
		onSuccess,
		onError,
	}: Props = $props();

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let is_loading = $state(false);
	let error = $state<AuthClientError | null>(null);

	async function handleSubmit() {
		is_loading = true;
		error = null;
		const result = await auth.api.signUp.email({
			name,
			email,
			password: password || undefined,
			org_name,
			invitation_id,
		});
		is_loading = false;
		if (result.ok) {
			onSuccess?.();
			window.location.href = redirect_to;
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
		name,
		email,
		password,
		is_loading,
		error,
		handleSubmit,
		handleOAuth,
		setName: (v) => (name = v),
		setEmail: (v) => (email = v),
		setPassword: (v) => (password = v),
	})}
{:else}
	<form onsubmit={handleSubmit}>
		<input type="text" bind:value={name} placeholder="Name" required />
		<input type="email" bind:value={email} placeholder="Email" required />
		<input
			type="password"
			bind:value={password}
			placeholder="Password"
			required={require_password} />

		{#if error}
			<p class="error">{error.message}</p>
		{/if}

		<button type="submit" disabled={is_loading}>
			{is_loading ? 'Signing up...' : 'Sign Up'}
		</button>

		{#each oauth_providers as provider}
			<button type="button" onclick={() => handleOAuth(provider)}>
				Continue with {provider}
			</button>
		{/each}
	</form>
{/if}
