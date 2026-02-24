<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '$lib/components';
	import Button from '$lib/form/Button.svelte';
	import Input from '$lib/form/Input.svelte';
	import { DelightError } from '@packages/lib';

	let email = $state('');
	let sent = $state(false);

	async function resetPassword() {
		if (!email?.trim() || sent) return;
		const params = new URLSearchParams();
		if (page.url.searchParams.has('redirect')) {
			params.set('redirect', page.url.searchParams.get('redirect') || '');
		}
		const response = await fetch(
			`/account/reset-password${params.size ? '?' : ''}${params}`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					email: email.trim(),
				}),
			},
		);
		if (!response.ok) {
			const error = await response.json();
			toast.error(DelightError.from(error).toString());
			throw error;
		} else {
			toast.success('Check your email for a link to reset your password');
			email = '';
			sent = true;
		}
	}
</script>

<section>
	<h1>Forgot your Password?</h1>
	<p>
		Enter your email address below and we will send you a link to reset your password.
	</p>
	<Input type="email" multiple={false} label="Email" bind:value={email}></Input>
	<Button fullWidth disabled={!email || sent} onclick={resetPassword}>
		Send Password Reset Link
	</Button>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	p {
		text-wrap: pretty;
	}
</style>
