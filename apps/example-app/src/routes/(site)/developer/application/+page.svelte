<script lang="ts">
	import Button from '$lib/form/Button.svelte';
	import BackArrowIcon from '~icons/material-symbols/arrow-back';
	import List from '$lib/form/List.svelte';
	import ListItem from '$lib/form/ListItem.svelte';

	const { data } = $props();
	const { applications } = $derived(data);
</script>

<div class="page" data-sveltekit-reload>
	<article>
		<header>
			<Button transparent dense href="/developer">
				<BackArrowIcon />
				Developer Portal
			</Button>
		</header>
		<section>
			<h1>OAuth Applications</h1>
			<List style="--radius: var(--radius-4);">
				{#each applications?.list || [] as application}
					<ListItem href={`/developer/application/${application.id}`}>
						{application.name}
					</ListItem>
				{/each}
				<ListItem href="/developer/application/new">Create OAuth Application</ListItem>
			</List>
		</section>
	</article>
</div>

<style>
	.page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 0 0 4rem;
	}
	article {
		display: flex;
		flex-direction: column;
		max-width: 450px;
		width: 100%;
		padding: 0 1rem;
	}
	header {
		margin-left: -0.5rem;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
</style>
