<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/form/Button.svelte';
	import Input from '$lib/form/Input.svelte';

	const { data } = $props();
	const { entities, authState } = $derived(data);

	const list = $derived(entities.search('person'));
	let name = $state('');
	let email = $state('');
	async function addPerson() {
		if (!name) return;
		const person = entities.create('person', {
			name,
			email: email || undefined,
		});
		await person.save();
		await goto(`/${authState.orgID}/dashboard/person/${person.id}`);
	}
</script>

<article>
	<section>
		<h1>People</h1>

		<Input label="Search" bind:value={list.query.term}></Input>

		{#if list.docs.length}
			<h2>Search Results</h2>
			<ul>
				{#each list.docs as person}
					<li>
						<a href="/{authState.orgID}/dashboard/person/{person.id}">
							{person.name}
							{#if person.email}
								<small>{person.email}</small>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
	<aside>
		<Input type="text" label="Name" bind:value={name}></Input>
		<Input type="email" label="Email" bind:value={email}></Input>
		<Button disabled={!name} onclick={() => addPerson()}>Add Person</Button>
	</aside>
</article>

<style>
	article {
		padding: 2rem;
		display: flex;
		align-items: start;
		gap: 2rem;
		width: 100%;
	}

	h2 {
		margin: 2rem 0;
	}
	section {
		flex: 1;
		/* width: 100%; */
	}
	aside {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		justify-content: start;
		align-items: start;
		min-width: 30%;
	}
</style>
