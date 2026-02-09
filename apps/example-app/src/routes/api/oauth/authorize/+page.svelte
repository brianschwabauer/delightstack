<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/form/Button.svelte';
	import './../../../(site)/global.css';
	import ListItem from '$lib/form/ListItem.svelte';
	import { List, Select } from '$lib/form';
	import { Toast, toast } from '$lib/components';

	const { data } = $props();
	const { authState, application, scopes, redirect_uri } = $derived(data);

	let selectedOrgID = $derived(authState.orgID || authState.org_ids?.[0] || '');

	const permissions = $derived.by(() => {
		const list = [];
		// prettier-ignore
		if (scopes.includes('profile:write'))	list.push('Change your name, email, and profile picture');
		else if (scopes.includes('profile:read')) list.push('Read your profile info (name, email, picture)');

		// prettier-ignore
		if (scopes.includes('org:write')) list.push('Update your organization info');
		else if (scopes.includes('org:read')) list.push('Read your organization info');

		// prettier-ignore
		if (scopes.includes('billing:write')) list.push('Update your billing info');
		else if (scopes.includes('billing:read')) list.push('Read your billing info');

		// prettier-ignore
		if (scopes.includes('person:write')) list.push('Create new people in your organization');
		else if (scopes.includes('person:read')) list.push('View people in your organization');

		// prettier-ignore
		if (scopes.includes('site:write')) list.push('Create new shareable sites');
		else if (scopes.includes('site:edit')) list.push('Create and delete shareable sites');
		else if (scopes.includes('site:read')) list.push('View shareable sites');

		// prettier-ignore
		if (scopes.includes('content:write')) list.push('Create new content (photos, posts, stories, documents)');
		else if (scopes.includes('content:edit')) list.push('Edit or delete any content');
		else if (scopes.includes('content:comment')) list.push('Comment on and react to content');
		else if (scopes.includes('content:read')) list.push('View all content in your organization');

		return list;
	});

	async function authorize() {
		const response = await fetch('/api/oauth/authorize', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_id: application.id,
				redirect_uri,
				org_id: selectedOrgID,
				scopes,
				state: page.url.searchParams.get('state') || '',
			}),
		});

		if (response.ok) {
			const data = await response.json<{ url?: string }>();
			if (!data.url) {
				toast.error('Authorization failed: No redirect URL provided');
				return;
			}
			window.location.href = data.url;
		} else {
			const error = await response.json<any>();
			toast.error(`Authorization failed: ${error?.message || 'Unknown error'}`);
		}
	}
</script>

<Toast />

<div class="page" data-sveltekit-reload>
	<article>
		<section>
			<h1>
				<strong>{application.name}</strong>
				would like to connect to your account
			</h1>
			{#if authState.signed_in}
				<Button class="account-action" transparent fullWidth dense>
					Signed in as {authState.email || authState.email || 'Guest'}
					{#snippet menu()}
						<List>
							<ListItem
								href="/signout?redirect={encodeURIComponent(
									page.url.pathname + page.url.search,
								)}">
								Sign in to another account
							</ListItem>
						</List>
					{/snippet}
				</Button>
			{/if}
			<div class="details">
				<div>
					<h2>Requested Permissions</h2>
					<ul>
						{#each permissions as permission}
							<li>{permission}</li>
						{/each}
					</ul>
				</div>
				<p>
					By clicking "Authorize", you agree to allow this application to access your
					account with the permissions listed above. You can revoke access at any time in
					your account settings.
				</p>
				{#if !application.verified_at}
					<p class="error">
						This application is not verified. Please proceed with caution and ensure you
						trust the developer before granting access.
					</p>
				{/if}
				{#if authState.orgs.length > 1}
					<Select
						options={authState.orgs.map((org) => org.id)}
						bind:value={selectedOrgID}
						label="Account">
						{#snippet children(orgID)}
							{orgID
								? authState.orgs.find((org) => org.id === orgID)?.name
								: 'Select Account'}
						{/snippet}
					</Select>
				{/if}
				<Button fullWidth disabled={!selectedOrgID} onclick={authorize}>Authorize</Button>
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
		padding: 2rem 0 6rem;
	}
	article {
		display: flex;
		flex-direction: column;
		max-width: 450px;
		width: 100%;
		padding: 0 1rem;
	}
	section {
		display: flex;
		flex-direction: column;
		h1 strong {
			font-weight: 900;
		}
		p {
			padding: 1rem 1.5rem;
			background-color: var(--color-bg-active);
			border-radius: var(--radius-3);
			&.error {
				background-color: var(--color-error);
				color: var(--color-error-text);
			}
		}

		:global(.account-action.button button) {
			display: flex;
			margin: 1rem 0 0;
		}
	}

	.details {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		h2 {
			font-size: 1.25rem;
			margin: 1rem 0 0;
		}
		ul {
			margin: 0.5rem 0 0;
		}
	}
</style>
