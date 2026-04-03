<script lang="ts">
	import { Button, Input, Select, Avatar, Modal, Callout } from '@delightstack/components';
	import { tooltip } from '@delightstack/utilities';

	const { data } = $props();
	const { db } = $derived(data);

	let search_term = $state('');
	let show_add = $state(false);

	// New person form
	let new_name = $state('');
	let new_email = $state('');
	let new_relationship = $state('');
	let new_birthday = $state('');
	let saving = $state(false);
	let error = $state('');

	const people = $derived(
		db.search('person', {
			term: search_term,
			limit: 100,
			order: [{ key: 'updated_at', direction: 'DESC' }],
		}),
	);

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

	async function addPerson() {
		if (!new_name.trim()) return;
		error = '';
		saving = true;
		try {
			await db.create('person', {
				name: new_name.trim(),
				email: new_email.trim() || undefined,
				relationship: new_relationship || undefined,
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

	function getInitials(name: string) {
		return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
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
		<Button onclick={() => (show_add = true)}>Add Person</Button>
	</header>

	<div class="search-bar">
		<Input placeholder="Search family members..." bind:value={search_term} type="search" />
	</div>

	<div class="people-grid">
		{#if !people.loading && people.docs.length === 0}
			<div class="empty">
				<p>No family members yet. Add someone to get started!</p>
			</div>
		{:else}
			{#each people.docs as person}
				<a href="/dashboard/family/{person.id}" class="person-card">
					<Avatar name={person.name} size="3" />
					<div class="person-info">
						<strong>{person.name}</strong>
						{#if person.relationship}
							<small {@attach tooltip(person.relationship ?? '')}>
								{person.relationship}
							</small>
						{/if}
						{#if person.email}
							<small class="email">{person.email}</small>
						{/if}
					</div>
				</a>
			{/each}
		{/if}
	</div>
</div>

<!-- Add Person Modal -->
<Modal bind:open={show_add} title="Add Family Member">
	{#if error}
		<Callout error>{error}</Callout>
	{/if}

	<form onsubmit={(e) => { e.preventDefault(); addPerson(); }} class="add-form">
		<Input label="Name" bind:value={new_name} required placeholder="Full name" />
		<Input label="Email" type="email" bind:value={new_email} placeholder="Optional" />
		<Select label="Relationship" bind:value={new_relationship} options={relationship_options} />
		<Input label="Birthday" type="date" bind:value={new_birthday} />

		<div class="modal-actions">
			<Button onclick={() => (show_add = false)} transparent>Cancel</Button>
			<Button onclick={addPerson} disabled={saving || !new_name.trim()}>
				{saving ? 'Adding...' : 'Add Person'}
			</Button>
		</div>
	</form>
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
		p { color: var(--color-text-disabled); }
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
		&:hover { background: var(--color-bg-2); }
	}
	.person-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		small {
			color: var(--color-text-disabled);
			text-transform: capitalize;
		}
		.email { text-transform: none; }
	}
	.empty {
		grid-column: 1 / -1;
		text-align: center;
		padding: var(--size-9) 0;
		p { color: var(--color-text-disabled); }
	}
	.add-form {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-2);
		margin-top: var(--size-2);
	}
</style>
