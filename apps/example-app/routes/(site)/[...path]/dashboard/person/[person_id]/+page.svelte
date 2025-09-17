<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';

	const { data } = $props();
	const { person, entities, authState } = $derived(data);

	const list = $derived(entities.search('person'));
</script>

<section>
	<h1>
		{person.value?.name}
		{#if person.value?.user_id === authState.id}
			<small>(Me)</small>
		{/if}
	</h1>
	<p>{person.created_at}</p>
	<input type="text" bind:value={person.value.name} />
	<button disabled={!person.hasChanges} onclick={() => person.save()}>
		Save Changes
	</button>
	<button onclick={() => person.delete().then(() => goto(`/dashboard/person`))}>
		Delete
	</button>
	<pre>Diff: {JSON.stringify(person.diff || {}, undefined, 2)}</pre>
	<pre>{JSON.stringify(person, undefined, 2)}</pre>
</section>

<section>
	<h1>People</h1>
	<input type="text" bind:value={list.query.term} placeholder="Search" />
	{#each list.data.hits as person (person.id)}
		<div>
			<a href={`/dashboard/person/${person.id}`}>{person.document.name}</a>
		</div>
	{/each}
</section>

{#if browser}
	<section>
		<h1>Full People</h1>
		{#await entities.list('person', { sparse: false }) then people}
			{#each people.list as person (person.id)}
				<div>
					<a href={`/dashboard/person/${person.id}`}>
						<pre>{JSON.stringify(person)}</pre>
					</a>
				</div>
			{/each}
		{:catch error}
			<p>{error.message}</p>
		{/await}
	</section>
{/if}
