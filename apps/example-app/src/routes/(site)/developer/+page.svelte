<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/form/Button.svelte';
	import BackArrowIcon from '~icons/material-symbols/arrow-back';

	const { data } = $props();
	const { authState } = $derived(data);
</script>

<div class="page" data-sveltekit-reload>
	<article>
		<header>
			<Button transparent dense href="/dashboard">
				<BackArrowIcon />
				Dashboard
			</Button>
		</header>
		<section>
			<h1>Developer Portal</h1>
			<div>
				<p>
					Welcome to the developer portal! Here you can manage your OAuth applications and
					integrations with our platform. If you have any questions or need assistance,
					please reach out to our support team.
				</p>
				<Button fullWidth href="/developer/application" style="margin-top: 2rem;">
					View OAuth Applications
				</Button>
				{#if authState.signed_in}
					<Button
						class="account-action"
						transparent
						fullWidth
						style="margin-top: 0.5rem"
						href="/signout?redirect={encodeURIComponent(page.url.pathname)}">
						Sign in to another account
						<small>
							Signed in as {authState.email || authState.email || 'Guest'}
						</small>
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

		:global(.account-action.button a) {
			display: flex;
			flex-direction: column;
			gap: 0;
			font-size: 1.35rem;
			small {
				font-size: 0.9rem;
			}
		}
	}
</style>
