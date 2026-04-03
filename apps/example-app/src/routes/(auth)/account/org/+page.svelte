<script lang="ts">
	import { Button, Input, Callout } from '@delightstack/components';
	import { List, ListItem } from '@delightstack/components/display';
	import { goto } from '$app/navigation';

	const { data } = $props();
	const { auth } = $derived(data);

	let org_name = $state('');
	let error = $state('');
	let loading = $state(false);

	$effect(() => {
		if (auth.signed_out) goto('/signin');
	});

	async function selectOrg(org_id: string) {
		error = '';
		loading = true;
		try {
			await auth.api.org.switch(org_id);
			window.location.href = '/dashboard';
		} catch (e: unknown) {
			error = (e as { message?: string })?.message || 'Failed to switch organization';
		} finally {
			loading = false;
		}
	}

	async function createOrg() {
		if (!org_name.trim()) return;
		error = '';
		loading = true;
		try {
			await auth.api.org.create({ name: org_name.trim() });
			window.location.href = '/dashboard';
		} catch (e: unknown) {
			error = (e as { message?: string })?.message || 'Failed to create organization';
		} finally {
			loading = false;
		}
	}
</script>

<div class="auth-page">
	<div class="auth-card">
		<h1>{auth.orgs.length ? 'Select Organization' : 'Create Organization'}</h1>
		<p class="subtitle">
			{auth.orgs.length
				? 'Choose an organization to continue'
				: 'Create your first organization to get started'}
		</p>

		{#if error}
			<Callout error>{error}</Callout>
		{/if}

		{#if auth.orgs.length}
			<List>
				{#each auth.orgs as org}
					<ListItem onclick={() => selectOrg(org.id)} disabled={loading}>
						{org.name}
					</ListItem>
				{/each}
			</List>

			<div class="divider"><span>or create a new one</span></div>
		{/if}

		<form onsubmit={(e) => { e.preventDefault(); createOrg(); }}>
			<div class="fields">
				<Input
					label="Organization Name"
					bind:value={org_name}
					required
					placeholder="My Family"
				/>
			</div>

			<Button onclick={createOrg} disabled={loading || !org_name.trim()} fullWidth>
				{loading ? 'Creating...' : 'Create Organization'}
			</Button>
		</form>

		<p class="footer">
			Wrong account? <a href="/signin">Sign in with a different account</a>
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
