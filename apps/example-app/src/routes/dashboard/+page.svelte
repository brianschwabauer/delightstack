<script lang="ts">
	import { Button, Input, Avatar } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
	import { tooltip } from '@delightstack/utilities';

	const { data } = $props();
	const { auth, db } = $derived(data);

	let search_term = $state('');

	const posts = $derived(
		db.search('post', {
			term: search_term,
			limit: 50,
			sortBy: { property: 'updated_at', order: 'DESC' },
		}),
	);

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString(undefined, {
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
		<Button href="/dashboard/post/new">Write a Post</Button>
	</header>

	<div class="search-bar">
		<Input
			placeholder="Search posts..."
			bind:value={search_term}
			type="search"
		/>
	</div>

	<div class="posts-grid">
		{#if posts.loaded && posts.docs.length === 0}
			<div class="empty">
				<p>No posts yet. Write your first family story!</p>
				<Button href="/dashboard/post/new">Get Started</Button>
			</div>
		{:else}
			{#each posts.docs as post}
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
								{#each post.tags.slice(0, 3) as tag}
									<Badge dense>{tag}</Badge>
								{/each}
							</div>
						{/if}
					</div>
				</a>
			{/each}
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
		p { color: var(--color-text-disabled); }
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
		transition: background 0.15s, box-shadow 0.15s;
		&:hover {
			background: var(--color-bg-2);
			box-shadow: var(--shadow-1);
		}
	}
	.post-header {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		h3 { flex: 1; }
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
		small { color: var(--color-text-disabled); }
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
		p { color: var(--color-text-disabled); }
	}
</style>
