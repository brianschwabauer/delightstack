<script lang="ts">
	import { Button, Input, Toggle, SplitPane, Progress, Callout } from '@delightstack/components';
	import Badge from '$lib/Badge.svelte';
	import { goto } from '$app/navigation';

	const { data } = $props();
	const { auth, db, ai } = $derived(data);

	let title = $state('');
	let content = $state('');
	let is_public = $state(false);
	let tags_input = $state('');
	let saving = $state(false);
	let save_error = $state('');

	// AI assist
	let ai_prompt = $state('');

	const tags = $derived(
		tags_input
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean),
	);

	async function savePost() {
		if (!title.trim() || !content.trim()) return;
		save_error = '';
		saving = true;
		try {
			const post = await db.create('post', {
				title: title.trim(),
				content: content.trim(),
				author_id: auth.id!,
				is_public,
				tags: tags.length ? tags : undefined,
			});
			goto(`/dashboard/post/${post.id}`);
		} catch (e) {
			save_error = e instanceof Error ? e.message : 'Failed to publish post';
		} finally {
			saving = false;
		}
	}

	async function askAi() {
		if (!ai_prompt.trim() && !content.trim()) return;
		const prompt = ai_prompt.trim() || `Help me improve this family story:\n\n${content}`;
		await ai.chat({
			messages: [
				{
					role: 'system',
					content: 'You are a helpful writing assistant for a family stories app. Help the user write warm, engaging family stories and memories. Keep responses concise and natural.',
				},
				{ role: 'user', content: prompt },
			],
			model: 'dynamic/@cf/meta/llama-3.1-8b-instruct',
		});
	}

	function useAiSuggestion() {
		if (ai.content) {
			content = content ? `${content}\n\n${ai.content}` : ai.content;
		}
	}
</script>

<svelte:head>
	<title>New Post | Forever Family</title>
</svelte:head>

<div class="page">
	<header>
		<h1>Write a Post</h1>
		<div class="actions">
			<Button href="/dashboard" transparent>Cancel</Button>
			<Button onclick={savePost} disabled={saving || !title.trim() || !content.trim()}>
				{saving ? 'Publishing...' : 'Publish'}
			</Button>
		</div>
	</header>

	{#if save_error}
		<Callout error>{save_error}</Callout>
	{/if}

	<SplitPane>
		{#snippet first()}
			<div class="editor">
				<Input label="Title" bind:value={title} placeholder="Give your story a title" />

				<Input
					label="Story"
					type="textarea"
					bind:value={content}
					placeholder="Write your family story..."
				/>

				<div class="post-options">
					<Toggle bind:checked={is_public} label="Share publicly" />
					<Input label="Tags" bind:value={tags_input} placeholder="family, vacation, birthday (comma-separated)" />
					{#if tags.length}
						<div class="tag-list">
							{#each tags as tag}
								<Badge dense>{tag}</Badge>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/snippet}

		{#snippet second()}
			<div class="ai-panel">
				<h3>AI Writing Assistant</h3>
				<p class="ai-description">Get help writing your family story</p>

				<div class="ai-input">
					<Input
						bind:value={ai_prompt}
						placeholder="Ask AI for help, e.g. 'Write about our beach trip'"
					/>
					<Button onclick={askAi} disabled={ai.streaming} dense>
						{ai.streaming ? 'Writing...' : 'Ask AI'}
					</Button>
				</div>

				{#if ai.streaming}
					<Progress loading />
				{/if}

				{#if ai.content}
					<div class="ai-response">
						<p>{ai.content}</p>
						<Button onclick={useAiSuggestion} dense transparent>
							Use this text
						</Button>
					</div>
				{/if}

				{#if ai.error}
					<p class="ai-error">{ai.error}</p>
				{/if}

				{#if ai.usage}
					<small class="ai-usage">{ai.usage.total_tokens} tokens used</small>
				{/if}
			</div>
		{/snippet}
	</SplitPane>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--size-4);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--size-3);
	}
	.actions {
		display: flex;
		gap: var(--size-2);
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--size-4);
		padding-right: var(--size-3);
	}
	.post-options {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
	}
	.tag-list {
		display: flex;
		gap: var(--size-1);
		flex-wrap: wrap;
	}

	/* AI Panel */
	.ai-panel {
		display: flex;
		flex-direction: column;
		gap: var(--size-3);
		padding-left: var(--size-3);
		border-left: 1px solid var(--color-outline);
		h3 { font-size: var(--font-size-2); }
	}
	.ai-description {
		color: var(--color-text-disabled);
		font-size: var(--font-size-0);
	}
	.ai-input {
		display: flex;
		gap: var(--size-2);
		align-items: flex-end;
	}
	.ai-response {
		background: var(--color-bg-2);
		padding: var(--size-3);
		border-radius: var(--radius-3);
		display: flex;
		flex-direction: column;
		gap: var(--size-2);
		p {
			font-size: var(--font-size-0);
			line-height: var(--font-lineheight-3);
			white-space: pre-wrap;
		}
	}
	.ai-error {
		color: var(--color-error);
		font-size: var(--font-size-0);
	}
	.ai-usage {
		color: var(--color-text-disabled);
	}
</style>
