<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
	import { page } from '$app/state';
	import Expand from '$lib/components/Expand.svelte';
	import { toast } from '$lib/components/toast-state.svelte.js';
	import Button from '$lib/form/Button.svelte';
	import Input from '$lib/form/Input.svelte';
	import List from '$lib/form/List.svelte';
	import ListItem from '$lib/form/ListItem.svelte';
	import { ApiError } from '@packages/lib';
	import { Org } from '@packages/types';

	const { data } = $props();
	const { authState } = $derived(data);
	let name = $state(`${(authState.name || '').trim().split(/\s+/).pop() || 'My'} Family`);
	let creatingNewFamily = $state(page.url.searchParams.has('new'));

	async function createFamily() {
		if (!name?.trim()) return;
		const response = await fetch(`/account`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				name: name.trim(),
			}),
		});
		if (!response.ok) {
			const error = await response.json();
			toast.error(ApiError.from(error).toString());
		} else {
			const data = await response.json<Org>();
			if (data.id) window.location.href = `/${data.id}/dashboard`;
			else window.location.href = `/dashboard`;
		}
	}

	async function deleteOrg(org_id: string) {
		const response = await fetch(`/api/org/${org_id}`, {
			method: 'DELETE',
		});
		if (response.ok) {
			window.location.href = '/account';
		} else {
			const data = await response.json().catch(() => undefined);
			const errorMessage = ApiError.from(data).toString();
			toast.error(errorMessage);
			throw { message: errorMessage };
		}
	}
</script>

<section data-sveltekit-reload>
	{#if !authState.orgs.length}
		<h1>Create a new family</h1>
		<Input type="text" multiple={false} label="Family Name" bind:value={name}></Input>
		<Button fullWidth onclick={createFamily}>Create Family Account</Button>
	{:else}
		<h1>Your Families</h1>
		<List style="--radius: var(--radius-4);">
			{#each authState.orgs as org}
				<ListItem href={`/${org.id}/dashboard`}>
					{org.name}
					{#snippet menu()}
						<div
							style="padding: .5rem; display: flex; flex-direction: column;"
							data-sveltekit-reload>
							<Button
								fullWidth
								transparent
								class="account-action"
								href={`/${org.id}/dashboard`}>
								Go to family dashboard
							</Button>
							{#if org.permissions.includes('billing:write')}
								<Button
									fullWidth
									transparent
									class="account-action"
									href={`/account/${org.id}/subscription`}>
									Manage account subscription
								</Button>
								<Button
									fullWidth
									transparent
									class="account-action"
									href={`/account/${org.id}/payment`}>
									Manage account payment
								</Button>
								<Button
									fullWidth
									transparent
									error
									class="account-action"
									onclick={() => deleteOrg(org.id)}>
									Delete account
								</Button>
							{/if}
						</div>
					{/snippet}
				</ListItem>
			{/each}
			<ListItem
				active={creatingNewFamily}
				onclick={() => (creatingNewFamily = !creatingNewFamily)}>
				Create New Family Account
			</ListItem>
		</List>
		<Expand show={creatingNewFamily}>
			<Input type="text" multiple={false} label="Family Name" bind:value={name}></Input>
			<Button fullWidth onclick={createFamily} style="margin: 1rem 0;">
				Create Family
			</Button>
		</Expand>
	{/if}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	:global(.account-action > button),
	:global(.account-action > a) {
		justify-content: end !important;
	}
</style>
