<script lang="ts">
	import {
		Button,
		Form,
		Input,
		Select,
		Avatar,
		Modal,
		Accordion,
		AccordionItem,
		Breadcrumbs,
		Callout,
	} from '@delightstack/components';
	import Icon from '$lib/Icon.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const { data } = $props();
	const { db } = $derived(data);

	const person_id = $derived(page.params.person_id);
	// +page.ts preloads the entity via this same client, so `db.entity` here
	// returns the already-loaded instance from the cache.
	const person = $derived(db.entity('person', person_id));

	// Schema-derived input props (name, type, label, required, parse, etc.)
	// carried by the entity itself — no separate table import needed.
	const field = $derived(person.form.field);

	let editing = $state(false);
	let show_delete = $state(false);

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
	<Breadcrumbs
		items={[
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
			{#if !editing}
				<div class="actions">
					<Button onclick={() => (editing = true)} transparent dense>
						<Icon name="edit" size={14} />
						<span>Edit</span>
					</Button>
					<Button onclick={() => (show_delete = true)} error transparent dense>
						<Icon name="trash" size={14} />
						<span>Delete</span>
					</Button>
				</div>
			{/if}
		</div>

		{#if person.error}
			<Callout error>
				{(person.error as Error).message ?? 'Something went wrong.'}
			</Callout>
		{/if}

		{#if editing}
			<!-- Entity-backed form: the Form edits person.value through the form
			     context (no bind:value), validates each field via its spread
			     parse, and person.save() runs on submit. -->
			<div class="edit-form">
				<Form entity={person} onsaved={() => (editing = false)}>
					<Input {...field.name} />
					<Input {...field.email} />
					<Input {...field.phone} />
					<Select {...field.relationship} clearable />
					<Input {...field.birthday} />
					<Input {...field.notes} />
					<div class="form-actions">
						<Button onclick={cancelEdit} transparent>Cancel</Button>
						<Button type="submit">Save</Button>
					</div>
				</Form>
			</div>
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
	<p>
		Are you sure you want to remove <strong>{person.value.name}</strong>
		from your family?
	</p>
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
		max-width: 500px;
	}
	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-2);
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
		small {
			color: var(--color-text-disabled);
		}
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
