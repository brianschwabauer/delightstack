<script lang="ts">
	import {
		Button,
		Form,
		Input,
		Select,
		Avatar,
		Modal,
		Callout,
	} from '@delightstack/components';
	import Icon from '$lib/Icon.svelte';
	import { tooltip } from '@delightstack/utilities';

	const { data } = $props();
	const { db } = $derived(data);

	let show_add = $state(false);

	// A draft entity backs the add form: the Form edits draft.value directly
	// and draft.save() creates the person on submit. After a successful save
	// the client rekeys its cache, so the next db.entity('person') call hands
	// out a fresh draft. Reading `db` once here is intentional — `openAdd()`
	// re-reads it for every subsequent draft.
	// svelte-ignore state_referenced_locally
	let draft = $state.raw(db.entity('person'));
	const field = $derived(draft.form.field);

	function openAdd() {
		draft = db.entity('person');
		show_add = true;
	}

	// The db client is stable for the life of the page — capturing it once to
	// create the live search query is intentional.
	// svelte-ignore state_referenced_locally
	const people = db.list('person');
</script>

<svelte:head>
	<title>Family | Forever Family</title>
</svelte:head>

<div class="page">
	<header>
		<div>
			<h1>Family Members</h1>
			<p>Manage your family directory</p>
		</div>
		<Button onclick={openAdd}>
			<Icon name="plus" size={16} />
			<span>Add person</span>
		</Button>
	</header>

	<div class="search-bar">
		<Input
			label="Search family members..."
			bind:value={people.query.term}
			type="search" />
	</div>

	<div class="people-grid">
		{#each people.items as person (person.id)}
			<a href="/dashboard/family/{person.id}" class="person-card">
				<Avatar name={person.name} size="3" />
				<div class="person-info">
					<strong>{person.name}</strong>
					{#if person.relationship}
						<small {@attach tooltip(String(person.relationship))}>
							{person.relationship}
						</small>
					{/if}
					{#if person.email}
						<small class="email">{person.email}</small>
					{/if}
				</div>
			</a>
		{/each}

		{#if people.items.length === 0 && people.status !== 'loading'}
			<div class="empty">
				{#if people.query.term}
					<p>No family members match "{people.query.term}".</p>
				{:else}
					<p>No family members yet. Add someone to get started!</p>
					<Button onclick={openAdd}>Add Person</Button>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Add Person Modal -->
<Modal bind:open={show_add} title="Add Family Member">
	{#if draft.error}
		<Callout error>
			{(draft.error as Error).message ?? 'Failed to add person'}
		</Callout>
	{/if}

	<!-- Entity-backed form: values flow through the form context (no
	     bind:value), each field validates via its spread parse, and submit
	     saves the draft. The submit Button auto-wires the saving state. -->
	<Form entity={draft} onsaved={() => (show_add = false)}>
		<Input {...field.name} />
		<Input {...field.email} placeholder="Optional" />
		<Select {...field.relationship} clearable />
		<Input {...field.birthday} />

		<div class="modal-actions">
			<Button onclick={() => (show_add = false)} transparent>Cancel</Button>
			<Button type="submit">Add Person</Button>
		</div>
	</Form>
</Modal>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-5);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--size-3);
		flex-wrap: wrap;
		h1 {
			font-family: var(--font-serif);
			font-size: var(--font-size-4);
			letter-spacing: -0.01em;
		}
		p {
			color: var(--color-text-disabled);
		}
	}
	.search-bar {
		max-width: 400px;
	}
	.people-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--size-3);
	}
	.person-card {
		display: flex;
		align-items: center;
		gap: var(--size-3);
		padding: var(--size-3);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		transition: background 0.15s;
		&:hover {
			background: var(--color-bg-2);
		}
	}
	.person-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		small {
			color: var(--color-text-disabled);
			text-transform: capitalize;
		}
		.email {
			text-transform: none;
		}
	}
	.empty {
		grid-column: 1 / -1;
		text-align: center;
		padding: var(--size-9) 0;
		p {
			color: var(--color-text-disabled);
		}
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-2);
		margin-top: var(--size-2);
	}
</style>
