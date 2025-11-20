<script lang="ts">
	import Button from '$lib/form/Button.svelte';
	import Input from '$lib/form/Input.svelte';
	import List from '$lib/form/List.svelte';
	import ListItem from '$lib/form/ListItem.svelte';
	import Range from '$lib/form/Range.svelte';
	import Select from '$lib/form/Select.svelte';
	import Taglist from '$lib/form/Taglist.svelte';
	import Toggle from '$lib/form/Toggle.svelte';
	const { data } = $props();
	const { authState } = $derived(data);
	const list = $derived(
		data.entities.search('post', {
			limit: 100,
			sortBy: { property: 'updated_at', order: 'DESC' },
		}),
	);
</script>

<article>
	<h1>Hello {authState.name}</h1>
	<p>Welcome to {authState.org?.name}</p>

	{#if list.loaded && list.docs.length}
		<div class="posts">
			{#each list.docs as post (post.id)}
				<div class="post">
					<a href="?modal=/post/{post.id}">
						<h2>{post.title}</h2>
						<p>{post.summary}</p>
					</a>
				</div>
			{/each}
		</div>
	{/if}

	<div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 5rem;">
		<Input multiple value={['asdf']} options={['asdf', 'Hello']}></Input>
		<div>
			<Button>Test</Button>
			<Button disabled>Test</Button>
			<Button translucent>Test</Button>
			<Button transparent>Test</Button>
			<Button accent>Test</Button>
			<Button success>Test</Button>
			<Button error>Test</Button>
			<Range value={0}></Range>
		</div>

		<List>
			<ListItem>Test</ListItem>
			<ListItem disabled>Disabled</ListItem>
			<ListItem active>Active</ListItem>
			<ListItem>Test</ListItem>
			<ListItem>Test</ListItem>
		</List>

		<Select options={['Test', 'Test2', 'Test3']} label="Test"></Select>
		<Taglist options={['Test', 'Test2']}></Taglist>
		<Toggle>Test</Toggle>
	</div>

	<div class="colors">
		<div class="row" style="gap: 0;">
			<div
				class="color"
				style="background-color: white; color:var(--c-text-dark); border:none; border-radius: 0; font-size: 1rem;">
				white
			</div>
			{#each [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950] as i}
				<div
					class="color"
					style="background-color:var(--c-{i}); color:var(--c-text-{i > 500
						? 'light'
						: 'dark'}); border:none; border-radius: 0; font-size: 1rem;">
					{i}
				</div>
			{/each}
			<div
				class="color"
				style="background-color: black; color:var(--c-text-light); border:none; border-radius: 0; font-size: 1rem;">
				black
			</div>
		</div>
		<div class="row">
			<div
				class="color"
				style="color:var(--c-text-disabled);border-color:var(--c-outline-disabled);">
				Test
			</div>
			<div class="color" style="color:var(--c-text);">Test</div>
			<div class="color" style="color:var(--c-text-hover);">Test</div>
			<div
				class="color"
				style="background-color:var(--c-bg-1); color:var(--c-text-active);">
				Test
			</div>
			<div
				class="color"
				style="background-color:var(--c-bg-1); color:var(--c-text-active);">
				Test
			</div>
			<div class="color" style="background-color:var(--c-bg-1); color:var(--c-text-3);">
				Test
			</div>
			<div class="color" style="background-color:var(--c-bg-1); color:var(--c-text-4);">
				Test
			</div>
			<div class="color" style="background-color:var(--c-bg-1); color:var(--c-text-5);">
				Test
			</div>
			<div class="color" style="background-color:var(--c-bg-1); color:var(--c-text-6);">
				Test
			</div>
		</div>
		<div class="row" style="color:var(--c-text);">
			<div class="color" style="background-color:var(--c-bg-00);">Test</div>
			<div class="color" style="background-color:var(--c-bg-0);">Test</div>
			<div class="color" style="background-color:var(--c-bg-1);">Test</div>
			<div class="color" style="background-color:var(--c-bg-2);">Test</div>
			<div class="color" style="background-color:var(--c-bg-3);">Test</div>
			<div class="color" style="background-color:var(--c-bg-4);">Test</div>
			<div class="color" style="background-color:var(--c-bg-5);">Test</div>
		</div>
		<div class="row">
			<div
				class="color"
				style="background-color:var(--c-bg-00); color:var(--c-text-disabled);">
			</div>
			<div
				class="color"
				style="background-color:var(--c-bg-1); color:var(--c-text-active);">
			</div>
			<div class="color" style="background-color:var(--c-bg-0-2); color:var(--c-text-2);">
			</div>
		</div>
		<div class="row" style="color-scheme: light">
			<div
				class="color"
				style="background-color:var(--c-bg-1); color:var(--c-text-disabled);">
				Test
			</div>
			<div
				class="color"
				style="background-color:var(--c-bg-1); color:var(--c-text-active);">
				Test
			</div>
			<div
				class="color"
				style="background-color:var(--c-bg-1); color:var(--c-text-active);">
				Test
			</div>
			<div class="color" style="background-color:var(--c-bg-1); color:var(--c-text-3);">
				Test
			</div>
			<div class="color" style="background-color:var(--c-bg-1); color:var(--c-text-4);">
				Test
			</div>
			<div class="color" style="background-color:var(--c-bg-1); color:var(--c-text-5);">
				Test
			</div>
			<div class="color" style="background-color:var(--c-bg-1); color:var(--c-text-6);">
				Test
			</div>
		</div>
		<div class="row" style="color-scheme: light; color:var(--c-text-dark);">
			<div class="color" style="background-color:var(--c-bg-00);">Test</div>
			<div class="color" style="background-color:var(--c-bg-0);">Test</div>
			<div class="color" style="background-color:var(--c-bg-1);">Test</div>
			<div class="color" style="background-color:var(--c-bg-2);">Test</div>
			<div class="color" style="background-color:var(--c-bg-3);">Test</div>
			<div class="color" style="background-color:var(--c-bg-4);">Test</div>
			<div class="color" style="background-color:var(--c-bg-5);">Test</div>
		</div>
		<div class="row" style="color-scheme: light">
			<div
				class="color"
				style="background-color:var(--c-bg-00); color:var(--c-text-disabled);">
			</div>
			<div
				class="color"
				style="background-color:var(--c-bg-1); color:var(--c-text-active);">
			</div>
			<div class="color" style="background-color:var(--c-bg-0-2); color:var(--c-text-2);">
			</div>
		</div>
		<div class="row" style="color-scheme: dark">
			<div
				class="color"
				style="background-color:var(--c-action-disabled); color:var(--c-action-text-disabled);">
				text
			</div>
			<div
				class="color"
				style="background-color:var(--c-action); color:var(--c-action-text);">
				text
			</div>
			<div
				class="color"
				style="background-color:var(--c-action-active); color:var(--c-action-text-active);">
				text
			</div>
		</div>
		<div class="row" style="color-scheme: light">
			<div
				class="color"
				style="background-color:var(--c-action-disabled); color:var(--c-action-text-disabled);">
				text
			</div>
			<div
				class="color"
				style="background-color:var(--c-action); color:var(--c-action-text);">
				text
			</div>
			<div
				class="color"
				style="background-color:var(--c-action-active); color:var(--c-action-text-active);">
				text
			</div>
		</div>
	</div>
</article>

<style>
	.colors {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.colors,
	.row {
		display: flex;
		gap: 1rem;
	}

	.color {
		width: 150px;
		height: 250px;
		border-radius: 1rem;
		border: solid 1px var(--c-outline);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		&:hover {
			color: var(--c-text-active) !important;
			border-color: var(--c-outline-active);
		}
	}

	article {
		padding: 2rem;
	}

	h1 {
		font-size: 2rem;
	}

	p {
		font-size: 1.5rem;
	}

	.posts {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 2rem 0;
		h2 {
			font-size: 2rem;
		}
	}
</style>
