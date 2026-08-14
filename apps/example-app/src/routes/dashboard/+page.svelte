<script lang="ts">
	import { Button, Input } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
	import Icon from '$lib/Icon.svelte';
	import { tooltip } from '@delightstack/utilities';

	const { data } = $props();
	const { db } = $derived(data);

	// The db client is stable for the life of the page — capturing it once to
	// create the live search query is intentional.
	// svelte-ignore state_referenced_locally
	const posts = db.watch('post', { limit: 50 });

	function formatDate(timestamp: string | number) {
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
	}
</script>

<svelte:head>
	<title>Home | Forever Family</title>
</svelte:head>

<div class="page">
	<header>
		<div>
			<h1>Family Stories</h1>
			<p>Share memories and moments with your family</p>
		</div>
		<Button href="/dashboard/post/new">
			<Icon name="plus" size={16} />
			<span>Write a post</span>
		</Button>
	</header>

	<div class="search-bar">
		<Input placeholder="Search posts..." bind:value={posts.query.term} type="search" />
	</div>

	<div class="posts-grid">
		{#each posts.docs as post (post.id)}
			<a href="/dashboard/post/{post.id}" class="post-card">
				<div class="post-header">
					<h3>{post.title}</h3>
					{#if post.is_public}
						<Badge {@attach tooltip('Visible to anyone with the link')}>Public</Badge>
					{/if}
				</div>
				{#if post.summary}
					<p class="post-summary">{post.summary}</p>
				{:else if post.content}
					<p class="post-summary">{post.content.slice(0, 150)}...</p>
				{/if}
				<div class="post-meta">
					<small>{formatDate(post.created_at)}</small>
					{#if post.tags?.length}
						<div class="tags">
							{#each post.tags.slice(0, 3) as tag (tag)}
								<Badge dense>{tag}</Badge>
							{/each}
						</div>
					{/if}
				</div>
			</a>
		{/each}

		{#if posts.docs.length === 0 && posts.status !== 'loading'}
			<div class="empty">
				{#if posts.query.term}
					<p>No posts match "{posts.query.term}".</p>
				{:else}
					<p>No posts yet. Write your first family story!</p>
					<Button href="/dashboard/post/new">Get Started</Button>
				{/if}
			</div>
		{/if}
	</div>
</div>

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
	.posts-grid {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
	}
	.post-card {
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
		padding: var(--size-4);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		transition:
			background 0.15s,
			box-shadow 0.15s;
		&:hover {
			background: var(--color-bg-2);
			box-shadow: var(--shadow-1);
		}
	}
	.post-header {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		h3 {
			flex: 1;
		}
	}
	.post-summary {
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
		line-height: var(--font-lineheight-3);
	}
	.post-meta {
		display: flex;
		align-items: center;
		gap: var(--size-3);
		small {
			color: var(--color-text-disabled);
		}
	}
	.tags {
		display: flex;
		gap: var(--size-1);
	}
	.empty {
		text-align: center;
		padding: var(--size-9) 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--size-3);
		p {
			color: var(--color-text-disabled);
		}
	}
</style>
