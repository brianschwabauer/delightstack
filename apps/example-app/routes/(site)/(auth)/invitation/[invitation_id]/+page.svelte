<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/form/Button.svelte';
	import BackArrowIcon from '~icons/material-symbols/arrow-back';
	import SignInForm from '../../SignInForm.svelte';
	import Expand from '$lib/components/Expand.svelte';

	const { data } = $props();
	const { authState, invitation } = $derived(data);
	const { userName, orgName, org_id } = $derived(invitation);

	let signing_in = $state(false);
</script>

<div class="page" data-sveltekit-reload>
	<article>
		<header>
			{#if authState.org_ids.includes(org_id)}
				<Button transparent dense href="/signout">
					<BackArrowIcon />
					Sign Out
				</Button>
			{:else}
				<Button transparent dense href={authState.signed_in ? '/dashboard' : '/'}>
					<BackArrowIcon />
					Decline Invitation
				</Button>
			{/if}
		</header>
		<section>
			<h1>
				{#if authState.org_ids.includes(org_id)}
					You are already a member of {orgName}
				{:else}
					{userName} has invited you to join {orgName}
				{/if}
			</h1>
			<div>
				{#if authState.org_ids.includes(org_id)}
					<p>Signed in as {authState.email}</p>
					<Button fullWidth href="/{org_id}/dashboard" style="margin-top: 1rem">
						Go to Dashboard
					</Button>
				{:else}
					<Expand show={!signing_in}>
						<p>
							By accepting the invitation, you will be given access to {orgName}.
							{#if authState.signed_in}
								You are currently signed in as {authState.email}.
							{:else}
								Creating an account is free and only takes a minute.
							{/if}
						</p>
						<Button
							fullWidth
							style="margin-top: 1rem"
							href={authState.signed_in ? `${page.url.pathname}/accept` : undefined}
							onclick={() => {
								if (!authState.signed_in) signing_in = true;
							}}>
							Accept Invitation
						</Button>
					</Expand>
				{/if}
				<Expand show={signing_in}>
					<SignInForm {authState} redirect="{page.url.pathname}/accept" mode="signup"
					></SignInForm>
				</Expand>
				{#if authState.signed_in}
					<Button
						transparent
						fullWidth
						style="margin-top: 0.5rem"
						href="/signout?redirect={encodeURIComponent(page.url.pathname)}">
						Sign in to different account
					</Button>
				{/if}
			</div>
		</section>
	</article>
</div>

<style>
	.page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 0 0 4rem;
	}
	article {
		display: flex;
		flex-direction: column;
		max-width: 450px;
		width: 100%;
		padding: 0 1rem;
	}
	header {
		margin-left: -0.5rem;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		p {
			padding: 1rem 1.5rem;
			background-color: var(--c-bg-active);
			border-radius: var(--radius-3);
		}
	}
</style>
