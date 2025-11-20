<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '$lib/components';
	import Button from '$lib/form/Button.svelte';
	import { ApiError } from '@packages/lib';

	const { data } = $props();
	const { authState } = $derived(data);
	let sent = $state(false);

	async function sendEmailVerificationEmail() {
		if (sent) return;
		const params = new URLSearchParams();
		if (page.url.searchParams.has('redirect')) {
			params.set('redirect', page.url.searchParams.get('redirect') || '');
		}
		const response = await fetch(
			`/account/verify-email${params.size ? '?' : ''}${params}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			},
		);
		if (!response.ok) {
			const error = await response.json();
			toast.error(ApiError.from(error).toString());
			throw error;
		} else {
			toast.success('Check your email for a link to verify your email');
			sent = true;
		}
	}
</script>

<section>
	<h1>Email Verification</h1>
	<p>
		Your email address must be verified before proceeding. Please check your email ({authState.email})
		for a link that will verify your email. If you haven't received an email, you can
		resend the email below
	</p>
	<Button
		style="margin-top: .5rem;"
		fullWidth
		onclick={sendEmailVerificationEmail}
		disabled={sent}>
		Resend Email
	</Button>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
</style>
