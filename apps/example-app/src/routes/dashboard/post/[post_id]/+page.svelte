<script lang="ts">
	import { Button, Input, Toggle, Modal, Callout, Progress } from '@delightstack/components';
	import { toast } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
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
			model: 'dynamic/@cf/meta/llama-3.1-8b-instruct',
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
</script>

<svelte:head>
	<title>{post?.title ?? 'Post'} | Forever Family</title>
</svelte:head>

<div class="page">
	{#if post}
		<header>
			<div class="title-area">
				<Button href="/dashboard" transparent dense>Back</Button>
				<h1>{post.title}</h1>
				{#if post.is_public}
					<Badge>Public</Badge>
				{/if}
			</div>
			<div class="actions">
				{#if post.is_public}
					<Button onclick={copyShareLink} transparent dense>Copy Link</Button>
				{/if}
				{#if editing}
					<Button onclick={() => (editing = false)} transparent>Cancel</Button>
					<Button onclick={savePost} disabled={saving}>
						{saving ? 'Saving...' : 'Save'}
					</Button>
				{:else}
					<Button onclick={startEditing} transparent>Edit</Button>
					<Button onclick={() => (show_delete = true)} error transparent dense>Delete</Button>
				{/if}
			</div>
		</header>

		{#if editing}
			<div class="edit-section">
				<Input label="Title" bind:value={edit_title} />
				<Input label="Content" type="textarea" bind:value={edit_content} />
				<Toggle bind:checked={edit_is_public} label="Share publicly" />
				<Input label="Tags" bind:value={edit_tags} placeholder="Comma-separated tags" />

				<!-- AI Assist inline -->
				<div class="ai-inline">
					<h4>AI Writing Assistant</h4>
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
			<article class="post-content">
				{#each post.content.split('\n') as paragraph}
					{#if paragraph.trim()}
						<p>{paragraph}</p>
					{/if}
				{/each}
			</article>

			{#if post.tags?.length}
				<div class="tag-list">
					{#each post.tags as tag}
						<Badge dense>{tag}</Badge>
					{/each}
				</div>
			{/if}

			<small class="post-date">
				Created {new Date(post.created_at).toLocaleDateString()}
				{#if post.updated_at !== post.created_at}
					&middot; Updated {new Date(post.updated_at).toLocaleDateString()}
				{/if}
			</small>
		{/if}
	{:else}
		<Callout>Loading post...</Callout>
	{/if}
</div>

<Modal bind:open={show_delete} title="Delete Post">
	<p>Are you sure you want to delete "<strong>{post?.title}</strong>"? This cannot be undone.</p>
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
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--size-3);
		flex-wrap: wrap;
	}
	.title-area {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		flex-wrap: wrap;
		h1 { font-family: var(--font-serif); }
	}
	.actions {
		display: flex;
		gap: var(--size-2);
	}
	.edit-section {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		max-width: 700px;
	}
	.post-content {
		max-width: var(--size-content-3);
		p {
			margin-bottom: var(--size-3);
			line-height: var(--font-lineheight-4);
		}
	}
	.tag-list {
		display: flex;
		gap: var(--size-1);
		flex-wrap: wrap;
	}
	.post-date {
		color: var(--color-text-disabled);
	}
	.ai-inline {
		background: var(--color-bg-2);
		padding: var(--size-3);
		border-radius: var(--radius-3);
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
		h4 { font-size: var(--font-size-0); }
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
		p {
			font-size: var(--font-size-0);
			white-space: pre-wrap;
			line-height: var(--font-lineheight-3);
		}
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--size-2);
		margin-top: var(--size-4);
	}
</style>
