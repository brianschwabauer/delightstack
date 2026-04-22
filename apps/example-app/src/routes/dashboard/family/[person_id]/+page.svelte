<script lang="ts">
	import { Button, Input, Select, Avatar, Modal, Accordion, AccordionItem, Breadcrumbs, Callout } from '@delightstack/components';
	import Icon from '$lib/Icon.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const { data } = $props();
	const { db } = $derived(data);

	const person_id = $derived(page.params.person_id);
	// +page.ts preloads the entity via this same client, so `db.entity` here
	// returns the already-loaded instance from the cache.
	const person = $derived(db.entity('person', person_id));

	let editing = $state(false);
	let show_delete = $state(false);

	const relationship_options = [
		{ value: '', label: 'Select...' },
		{ value: 'parent', label: 'Parent' },
		{ value: 'child', label: 'Child' },
		{ value: 'sibling', label: 'Sibling' },
		{ value: 'spouse', label: 'Spouse' },
		{ value: 'grandparent', label: 'Grandparent' },
		{ value: 'grandchild', label: 'Grandchild' },
		{ value: 'aunt-uncle', label: 'Aunt/Uncle' },
		{ value: 'cousin', label: 'Cousin' },
		{ value: 'friend', label: 'Friend' },
		{ value: 'other', label: 'Other' },
	];

	async function savePerson() {
		const v = person.value;
		await person.save({
			name: v.name?.trim(),
			email: v.email?.trim() || undefined,
			phone: v.phone?.trim() || undefined,
			relationship: v.relationship || undefined,
			birthday: v.birthday || undefined,
			notes: v.notes?.trim() || undefined,
		});
		editing = false;
	}

	function cancelEdit() {
		person.reset();
		editing = false;
	}

	async function deletePerson() {
		await person.delete();
		goto('/dashboard/family');
	}
</script>

<svelte:head>
	<title>{person.value.name ?? 'Person'} | Forever Family</title>
</svelte:head>

<div class="page">
	<Breadcrumbs items={[
		{ label: 'Family', href: '/dashboard/family' },
		{ label: person.value.name ?? 'Loading...' },
	]} />

	{#if person.loaded}
		<div class="profile-header">
			<Avatar name={person.value.name} size="4" />
			<div class="profile-info">
				<h1>{person.value.name}</h1>
				{#if person.value.relationship}
					<span class="relationship">{person.value.relationship}</span>
				{/if}
			</div>
			<div class="actions">
				{#if editing}
					<Button onclick={cancelEdit} transparent>Cancel</Button>
					<Button onclick={savePerson} disabled={person.saving}>
						{person.saving ? 'Saving...' : 'Save'}
					</Button>
				{:else}
					<Button onclick={() => (editing = true)} transparent dense>
						<Icon name="edit" size={14} />
						<span>Edit</span>
					</Button>
					<Button onclick={() => (show_delete = true)} error transparent dense>
						<Icon name="trash" size={14} />
						<span>Delete</span>
					</Button>
				{/if}
			</div>
		</div>

		{#if person.error}
			<Callout error>{(person.error as Error).message ?? 'Something went wrong.'}</Callout>
		{/if}

		{#if editing}
			<form onsubmit={(e) => { e.preventDefault(); savePerson(); }} class="edit-form">
				<Input label="Name" bind:value={person.value.name} required />
				<Input label="Email" type="email" bind:value={person.value.email} />
				<Input label="Phone" type="tel" bind:value={person.value.phone} />
				<Select label="Relationship" bind:value={person.value.relationship} options={relationship_options} />
				<Input label="Birthday" type="date" bind:value={person.value.birthday} />
				<Input label="Notes" bind:value={person.value.notes} placeholder="Notes about this person..." />
			</form>
		{:else}
			<div class="details">
				<Accordion value="contact" multiple>
					<AccordionItem title="Contact Info" value="contact">
						<div class="detail-grid">
							{#if person.value.email}
								<div class="detail">
									<small>Email</small>
									<span>{person.value.email}</span>
								</div>
							{/if}
							{#if person.value.phone}
								<div class="detail">
									<small>Phone</small>
									<span>{person.value.phone}</span>
								</div>
							{/if}
							{#if person.value.birthday}
								<div class="detail">
									<small>Birthday</small>
									<span>{person.value.birthday}</span>
								</div>
							{/if}
							{#if !person.value.email && !person.value.phone && !person.value.birthday}
								<p class="no-data">No contact info added yet.</p>
							{/if}
						</div>
					</AccordionItem>
					{#if person.value.notes}
						<AccordionItem title="Notes" value="notes">
							<p>{person.value.notes}</p>
						</AccordionItem>
					{/if}
				</Accordion>
			</div>
		{/if}
	{:else}
		<Callout>Loading person details...</Callout>
	{/if}
</div>

<!-- Delete confirmation modal -->
<Modal bind:open={show_delete} title="Delete Person">
	<p>Are you sure you want to remove <strong>{person.value.name}</strong> from your family?</p>
	<div class="modal-actions">
		<Button onclick={() => (show_delete = false)} transparent>Cancel</Button>
		<Button onclick={deletePerson} error>Delete</Button>
	</div>
</Modal>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-5);
	}
	.profile-header {
		display: flex;
		align-items: center;
		gap: var(--size-4);
		flex-wrap: wrap;
		padding: var(--size-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
	}
	.profile-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		h1 {
			font-family: var(--font-serif);
			font-size: var(--font-size-4);
			letter-spacing: -0.01em;
		}
		.relationship {
			text-transform: capitalize;
			color: var(--color-text-disabled);
			font-size: var(--font-size-0);
		}
	}
	.actions {
		display: flex;
		gap: var(--size-2);
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		max-width: 500px;
	}
	.detail-grid {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: 2px;
		small { color: var(--color-text-disabled); }
	}
	.no-data {
		color: var(--color-text-disabled);
		font-style: italic;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-2);
		margin-top: var(--size-4);
	}
</style>
