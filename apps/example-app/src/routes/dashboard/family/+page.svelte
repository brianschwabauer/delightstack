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
	import { personTable } from '$lib/schema';
	import { tooltip } from '@delightstack/utilities';

	// Schema-derived input props (name, type, label, required, etc.)
	const field = personTable.form.field;

	const { data } = $props();
	const { db } = $derived(data);

	let show_add = $state(false);

	// New person form
	let new_name = $state('');
	let new_email = $state('');
	type Relationship =
		| 'parent'
		| 'child'
		| 'sibling'
		| 'spouse'
		| 'grandparent'
		| 'grandchild'
		| 'aunt-uncle'
		| 'cousin'
		| 'friend'
		| 'other';
	let new_relationship = $state<Relationship | ''>('');
	let new_birthday = $state('');
	let saving = $state(false);
	let error = $state('');

	const people = db.search('person');

	async function addPerson() {
		if (!new_name.trim()) return;
		error = '';
		saving = true;
		try {
			await db.create('person', {
				name: new_name.trim(),
				email: new_email.trim() || undefined,
				relationship: new_relationship === '' ? undefined : new_relationship,
				birthday: new_birthday || undefined,
			});
			new_name = '';
			new_email = '';
			new_relationship = '';
			new_birthday = '';
			show_add = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to add person';
		} finally {
			saving = false;
		}
	}
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
		<Button onclick={() => (show_add = true)}>
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
		{#each people.docs as person (person.id)}
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

		{#if people.docs.length === 0 && !people.loading}
			<div class="empty">
				{#if people.query.term}
					<p>No family members match "{people.query.term}".</p>
				{:else}
					<p>No family members yet. Add someone to get started!</p>
					<Button onclick={() => (show_add = true)}>Add Person</Button>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Add Person Modal -->
<Modal bind:open={show_add} title="Add Family Member">
	{#if error}
		<Callout error>{error}</Callout>
	{/if}

	<!-- The table's form schema validates every field on submit; each Input's
	     spread props register its field-level parse with the Form as well. -->
	<Form schema={personTable.form.schema} onsubmit={addPerson}>
		<Input {...field.name} bind:value={new_name} />
		<Input {...field.email} bind:value={new_email} placeholder="Optional" />
		<Select {...field.relationship} bind:value={new_relationship} clearable />
		<Input {...field.birthday} bind:value={new_birthday} />

		<div class="modal-actions">
			<Button onclick={() => (show_add = false)} transparent>Cancel</Button>
			<Button type="submit" disabled={saving}>
				{saving ? 'Adding...' : 'Add Person'}
			</Button>
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
