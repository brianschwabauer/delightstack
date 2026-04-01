<script lang="ts">
	import { Button } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';

	const { data } = $props();
	const { post } = $derived(data);
</script>

<svelte:head>
	<title>{post.title} | Forever Family</title>
	<meta name="description" content={post.summary ?? post.content.slice(0, 160)} />
</svelte:head>

<div class="public-post">
	<nav class="nav">
		<a href="/" class="logo">Forever Family</a>
		<Button href="/signup" dense>Join Forever Family</Button>
	</nav>

	<article>
		<header>
			<h1>{post.title}</h1>
			<div class="meta">
				<small>Published {new Date(post.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</small>
				{#if post.tags?.length}
					<div class="tags">
						{#each post.tags as tag}
							<Badge dense>{tag}</Badge>
						{/each}
					</div>
				{/if}
			</div>
		</header>

		<div class="content">
			{#each post.content.split('\n') as paragraph}
				{#if paragraph.trim()}
					<p>{paragraph}</p>
				{/if}
			{/each}
		</div>
	</article>

	<footer>
		<p>
			Shared from <a href="/">Forever Family</a> — a family management platform
			built with <strong>Delightstack</strong>.
		</p>
	</footer>
</div>

<style>
	.public-post {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}
	.nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--size-3) var(--size-5);
		max-width: 800px;
		width: 100%;
		margin: 0 auto;
	}
	.logo {
		font-family: var(--font-serif);
		font-size: var(--font-size-3);
		font-weight: var(--font-weight-7);
	}
	article {
		max-width: 700px;
		width: 100%;
		margin: 0 auto;
		padding: var(--size-5);
	}
	header {
		margin-bottom: var(--size-5);
		h1 {
			font-family: var(--font-serif);
			font-size: var(--font-size-fluid-2);
			line-height: 1.2;
			margin-bottom: var(--size-3);
		}
	}
	.meta {
		display: flex;
		align-items: center;
		gap: var(--size-3);
		flex-wrap: wrap;
		small { color: var(--color-text-disabled); }
	}
	.tags {
		display: flex;
		gap: var(--size-1);
	}
	.content {
		p {
			margin-bottom: var(--size-3);
			line-height: var(--font-lineheight-4);
			font-size: var(--font-size-2);
		}
	}
	footer {
		text-align: center;
		padding: var(--size-5);
		border-top: 1px solid var(--color-outline);
		margin-top: auto;
		p {
			font-size: var(--font-size-0);
			color: var(--color-text-disabled);
		}
		a { color: var(--color-action); }
	}
</style>
