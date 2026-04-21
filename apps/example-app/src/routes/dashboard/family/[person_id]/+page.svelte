<script lang="ts">
	import { Button, Input, Select, Avatar, Modal, Accordion, AccordionItem, Breadcrumbs, Callout } from '@delightstack/components';
	import Icon from '$lib/Icon.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const { data } = $props();
	const { db } = $derived(data);

	const person_id = $derived(page.params.person_id);
	const person = $derived(await db.get('person', person_id));

	let editing = $state(false);
	let show_delete = $state(false);
	let saving = $state(false);

	// Edit form state
	let edit_name = $state('');
	let edit_email = $state('');
	let edit_phone = $state('');
	let edit_relationship = $state('');
	let edit_birthday = $state('');
	let edit_notes = $state('');

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

	function startEditing() {
		if (!person) return;
		edit_name = person.name;
		edit_email = person.email ?? '';
		edit_phone = person.phone ?? '';
		edit_relationship = person.relationship ?? '';
		edit_birthday = person.birthday ?? '';
		edit_notes = person.notes ?? '';
		editing = true;
	}

	async function savePerson() {
		saving = true;
		try {
			await db.update('person', person_id, {
				name: edit_name.trim(),
				email: edit_email.trim() || undefined,
				phone: edit_phone.trim() || undefined,
				relationship: edit_relationship || undefined,
				birthday: edit_birthday || undefined,
				notes: edit_notes.trim() || undefined,
			});
			editing = false;
		} finally {
			saving = false;
		}
	}

	async function deletePerson() {
		await db.delete('person', person_id);
		goto('/dashboard/family');
	}
</script>

<svelte:head>
	<title>{person?.name ?? 'Person'} | Forever Family</title>
</svelte:head>

<div class="page">
	<Breadcrumbs items={[
		{ label: 'Family', href: '/dashboard/family' },
		{ label: person?.name ?? 'Loading...' },
	]} />

	{#if person}
		<div class="profile-header">
			<Avatar name={person.name} size="4" />
			<div class="profile-info">
				<h1>{person.name}</h1>
				{#if person.relationship}
					<span class="relationship">{person.relationship}</span>
				{/if}
			</div>
			<div class="actions">
				{#if editing}
					<Button onclick={() => (editing = false)} transparent>Cancel</Button>
					<Button onclick={savePerson} disabled={saving}>
						{saving ? 'Saving...' : 'Save'}
					</Button>
				{:else}
					<Button onclick={startEditing} transparent dense>
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

		{#if editing}
			<form onsubmit={(e) => { e.preventDefault(); savePerson(); }} class="edit-form">
				<Input label="Name" bind:value={edit_name} required />
				<Input label="Email" type="email" bind:value={edit_email} />
				<Input label="Phone" type="tel" bind:value={edit_phone} />
				<Select label="Relationship" bind:value={edit_relationship} options={relationship_options} />
				<Input label="Birthday" type="date" bind:value={edit_birthday} />
				<Input label="Notes" bind:value={edit_notes} placeholder="Notes about this person..." />
			</form>
		{:else}
			<div class="details">
				<Accordion value="contact" multiple>
					<AccordionItem title="Contact Info" value="contact">
						<div class="detail-grid">
							{#if person.email}
								<div class="detail">
									<small>Email</small>
									<span>{person.email}</span>
								</div>
							{/if}
							{#if person.phone}
								<div class="detail">
									<small>Phone</small>
									<span>{person.phone}</span>
								</div>
							{/if}
							{#if person.birthday}
								<div class="detail">
									<small>Birthday</small>
									<span>{person.birthday}</span>
								</div>
							{/if}
							{#if !person.email && !person.phone && !person.birthday}
								<p class="no-data">No contact info added yet.</p>
							{/if}
						</div>
					</AccordionItem>
					{#if person.notes}
						<AccordionItem title="Notes" value="notes">
							<p>{person.notes}</p>
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
	<p>Are you sure you want to remove <strong>{person?.name}</strong> from your family?</p>
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
