<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '$lib/components';
	import Button from '$lib/form/Button.svelte';
	import Input from '$lib/form/Input.svelte';
	import { ApiError } from '@packages/lib';

	const { data } = $props();
	let password = $state('');

	async function resetPassword() {
		if (!password) return;
		const response = await fetch(
			`/account/reset-password/${page.params.password_reset_token}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password }),
			},
		);
		if (!response.ok) {
			const error = await response.json();
			toast.error(ApiError.from(error).toString());
			throw error;
		}
		let path = page.url.searchParams.get('redirect') || '/dashboard';
		if (!path.startsWith('/')) {
			const invalid_url =
				!path.match(/^https?:\/\//) || new URL(path).host !== page.url.host;
			if (invalid_url) path = '/dashboard';
		}
		if (path === '/') path = '/dashboard';
		window.location.href = `${path}?toast=${encodeURIComponent(`Successfully reset your password!`)}`;
	}
</script>

<section>
	<h1>Reset Password</h1>
	<p>Enter your new password for your account {data.email}</p>
	<Input type="password" multiple={false} label="New Password" bind:value={password}
	></Input>
	<Button fullWidth disabled={!password} onclick={resetPassword}>Change Password</Button>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
</style>
