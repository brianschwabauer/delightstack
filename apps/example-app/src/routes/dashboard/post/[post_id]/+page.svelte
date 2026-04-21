<script lang="ts">
	import { Button, Input, Toggle, Modal, Callout, Progress } from '@delightstack/components';
	import { toast } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
	import Icon from '$lib/Icon.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const { data } = $props();
	const { auth, db, ai } = $derived(data);

	const post_id = $derived(page.params.post_id);
	const post = $derived(await db.get('post', post_id));

	let editing = $state(false);
	let show_delete = $state(false);
	let saving = $state(false);

	// Edit state
	let edit_title = $state('');
	let edit_content = $state('');
	let edit_is_public = $state(false);
	let edit_tags = $state('');

	// AI assist
	let ai_prompt = $state('');

	function startEditing() {
		if (!post) return;
		edit_title = post.title;
		edit_content = post.content;
		edit_is_public = post.is_public;
		edit_tags = post.tags?.join(', ') ?? '';
		editing = true;
	}

	async function savePost() {
		saving = true;
		try {
			const tags = edit_tags.split(',').map((t) => t.trim()).filter(Boolean);
			await db.update('post', post_id, {
				title: edit_title.trim(),
				content: edit_content.trim(),
				is_public: edit_is_public,
				tags: tags.length ? tags : undefined,
			});
			editing = false;
			toast('Post updated');
		} finally {
			saving = false;
		}
	}

	async function deletePost() {
		await db.delete('post', post_id);
		goto('/dashboard');
	}

	async function improveWithAi() {
		const prompt = ai_prompt.trim() || `Improve this family story while keeping its personal tone:\n\n${editing ? edit_content : post?.content}`;
		await ai.chat({
			messages: [
				{
					role: 'system',
					content: 'You are a helpful writing assistant. Improve the given text while keeping its personal, family-oriented tone. Return only the improved text.',
				},
				{ role: 'user', content: prompt },
			],
			model: '@cf/meta/llama-3.1-8b-instruct',
		});
	}

	function applyAiContent() {
		if (ai.content) {
			edit_content = ai.content;
			toast('AI suggestion applied');
		}
	}

	function copyShareLink() {
		if (post?.is_public) {
			navigator.clipboard.writeText(`${window.location.origin}/post/${post.id}`);
			toast('Share link copied!');
		}
	}

	function formatDate(ts: string | number) {
		return new Date(ts).toLocaleDateString(undefined, {
			month: 'long',
			day: 'numeric',
			year: 'numeric',
		});
	}
</script>

<svelte:head>
	<title>{post?.title ?? 'Post'} | Forever Family</title>
</svelte:head>

<div class="page">
	<a href="/dashboard" class="back">
		<Icon name="arrow-left" size={16} />
		<span>All stories</span>
	</a>

	{#if post}
		{#if editing}
			<div class="edit-card">
				<div class="edit-header">
					<h2>Edit story</h2>
					<div class="actions">
						<Button onclick={() => (editing = false)} transparent>Cancel</Button>
						<Button onclick={savePost} disabled={saving}>
							{saving ? 'Saving...' : 'Save changes'}
						</Button>
					</div>
				</div>

				<Input label="Title" bind:value={edit_title} />
				<Input label="Content" type="textarea" bind:value={edit_content} />
				<Input label="Tags" bind:value={edit_tags} placeholder="Comma-separated tags" />
				<Toggle bind:checked={edit_is_public} label="Share publicly" />

				<div class="ai-inline">
					<div class="ai-header">
						<Icon name="sparkles" size={16} />
						<h4>AI writing assistant</h4>
					</div>
					<div class="ai-row">
						<Input bind:value={ai_prompt} placeholder="Ask AI to improve your post..." />
						<Button onclick={improveWithAi} disabled={ai.streaming} dense>
							{ai.streaming ? 'Writing...' : 'Improve'}
						</Button>
					</div>
					{#if ai.streaming}
						<Progress loading />
					{/if}
					{#if ai.content}
						<div class="ai-suggestion">
							<p>{ai.content}</p>
							<Button onclick={applyAiContent} dense transparent>Apply suggestion</Button>
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<article class="article">
				<header class="article-header">
					<div class="meta-row">
						<time datetime={String(post.created_at)}>{formatDate(post.created_at)}</time>
						{#if post.is_public}
							<span class="dot">•</span>
							<span class="public-tag">
								<Icon name="eye" size={14} />
								Public
							</span>
						{/if}
					</div>

					<h1>{post.title}</h1>

					{#if post.summary}
						<p class="lead">{post.summary}</p>
					{/if}

					<div class="toolbar">
						{#if post.is_public}
							<Button onclick={copyShareLink} transparent dense>
								<Icon name="share" size={14} />
								<span>Copy link</span>
							</Button>
						{/if}
						<Button onclick={startEditing} transparent dense>
							<Icon name="edit" size={14} />
							<span>Edit</span>
						</Button>
						<Button onclick={() => (show_delete = true)} error transparent dense>
							<Icon name="trash" size={14} />
							<span>Delete</span>
						</Button>
					</div>
				</header>

				<div class="article-body">
					{#each post.content.split('\n') as paragraph, i (i)}
						{#if paragraph.trim()}
							<p>{paragraph}</p>
						{/if}
					{/each}
				</div>

				<footer class="article-footer">
					{#if post.tags?.length}
						<div class="tag-list">
							<Icon name="tag" size={14} />
							{#each post.tags as tag (tag)}
								<Badge dense>{tag}</Badge>
							{/each}
						</div>
					{/if}

					<small class="post-date">
						{#if post.updated_at !== post.created_at}
							Last updated {formatDate(post.updated_at)}
						{/if}
					</small>
				</footer>
			</article>
		{/if}
	{:else}
		<div class="loading">
			<Callout>Loading story...</Callout>
		</div>
	{/if}
</div>

<Modal bind:open={show_delete} title="Delete story">
	<p>Are you sure you want to delete <strong>"{post?.title}"</strong>? This cannot be undone.</p>
	<div class="modal-actions">
		<Button onclick={() => (show_delete = false)} transparent>Cancel</Button>
		<Button onclick={deletePost} error>Delete</Button>
	</div>
</Modal>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-4);
		max-width: var(--size-content-3);
		margin: 0 auto;
		width: 100%;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: var(--size-1);
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
		width: fit-content;
		transition: color 0.15s;
		&:hover { color: var(--color-text); }
	}
	.loading {
		padding: var(--size-5) 0;
	}

	/* Article view */
	.article {
		display: flex;
		flex-direction: column;
		gap: var(--size-5);
	}
	.article-header {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding-bottom: var(--size-4);
		border-bottom: 1px solid var(--color-outline);
	}
	.meta-row {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
		time { font-variant-numeric: tabular-nums; }
	}
	.public-tag {
		display: inline-flex;
		align-items: center;
		gap: var(--size-1);
	}
	.dot { opacity: 0.5; }
	.article-header h1 {
		font-family: var(--font-serif);
		font-size: var(--font-size-6);
		line-height: var(--font-lineheight-1);
		letter-spacing: -0.01em;
		@media (max-width: 600px) {
			font-size: var(--font-size-5);
		}
	}
	.lead {
		font-size: var(--font-size-2);
		line-height: var(--font-lineheight-3);
		color: var(--color-text-disabled);
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--size-1);
		margin-top: var(--size-2);
	}

	.article-body {
		font-size: var(--font-size-2);
		line-height: var(--font-lineheight-5);
		p {
			margin-bottom: var(--size-4);
			&:first-child::first-letter {
				font-family: var(--font-serif);
				font-size: var(--font-size-6);
				font-weight: var(--font-weight-6);
				float: left;
				line-height: 0.9;
				margin: 4px var(--size-2) 0 0;
				color: var(--color-action);
			}
		}
	}
	.article-footer {
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
		padding-top: var(--size-4);
		border-top: 1px solid var(--color-outline);
	}
	.tag-list {
		display: flex;
		gap: var(--size-1);
		flex-wrap: wrap;
		align-items: center;
		color: var(--color-text-disabled);
	}
	.post-date {
		color: var(--color-text-disabled);
		font-size: var(--font-size-00);
	}

	/* Edit view */
	.edit-card {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding: var(--size-4);
		border: 1px solid var(--color-outline);
		border-radius: var(--radius-3);
		background: var(--color-bg-1);
	}
	.edit-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--size-2);
		padding-bottom: var(--size-3);
		border-bottom: 1px solid var(--color-outline);
		h2 {
			font-family: var(--font-serif);
			font-size: var(--font-size-3);
		}
	}
	.actions {
		display: flex;
		gap: var(--size-2);
	}

	.ai-inline {
		background: var(--color-bg-2);
		padding: var(--size-3);
		border-radius: var(--radius-3);
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
		margin-top: var(--size-2);
	}
	.ai-header {
		display: flex;
		align-items: center;
		gap: var(--size-1);
		color: var(--color-text-disabled);
		h4 {
			font-size: var(--font-size-0);
			font-weight: var(--font-weight-6);
		}
	}
	.ai-row {
		display: flex;
		gap: var(--size-2);
		align-items: flex-end;
	}
	.ai-suggestion {
		background: var(--color-bg-0);
		padding: var(--size-3);
		border-radius: var(--radius-2);
		border: 1px solid var(--color-outline);
		p {
			font-size: var(--font-size-0);
			white-space: pre-wrap;
			line-height: var(--font-lineheight-3);
			margin-bottom: var(--size-2);
		}
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-2);
		margin-top: var(--size-4);
	}
</style>
