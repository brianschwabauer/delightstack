<script lang="ts">
	import {
		Editor as EditorClass,
		defaultBlocks,
		type Uploader,
	} from '@delightstack/editor';
	import { Editor, Toolbar } from '@delightstack/editor/components';
	import { Button, Toggle } from '@delightstack/components';
	import { sampleDoc } from './sample-doc.js';

	// Demo uploader: simulates progress, then serves the file from a blob URL.
	// A real app implements this with @delightstack/images.
	const uploader: Uploader = {
		async upload(file, { signal, on_progress }) {
			for (let step = 1; step <= 12; step++) {
				await new Promise((resolve) => setTimeout(resolve, 150));
				if (signal.aborted) throw new Error('aborted');
				on_progress?.(step / 12);
			}
			const url = URL.createObjectURL(file);
			if (file.type.startsWith('image/')) {
				const size = await new Promise<{ width: number; height: number }>(
					(resolve, reject) => {
						const img = new Image();
						img.onload = () =>
							resolve({ width: img.naturalWidth, height: img.naturalHeight });
						img.onerror = reject;
						img.src = url;
					},
				);
				return {
					image: { id: crypto.randomUUID(), src: url, alt: file.name, ...size },
				};
			}
			return { file: { url, name: file.name, size: file.size, mime: file.type } };
		},
	};

	const editor = new EditorClass({
		placeholder: 'Write something delightful…',
		blocks: defaultBlocks(),
		uploader,
		content: sampleDoc,
	});

	let readonly = $state(false);
	let show_json = $state(false);
</script>

<svelte:head>
	<title>Editor Playground</title>
</svelte:head>

<main>
	<header>
		<h1>@delightstack/editor</h1>
		<div class="controls">
			<span class="status">
				{editor.selection.from}–{editor.selection.to}
				{#if editor.active_block}· {editor.active_block.name}{/if}
				{#if Object.keys(editor.active_marks).length}
					· {Object.keys(editor.active_marks).join(', ')}
				{/if}
			</span>
			<Button dense outline disabled={!editor.can_undo} onclick={() => editor.undo()}>
				Undo
			</Button>
			<Button dense outline disabled={!editor.can_redo} onclick={() => editor.redo()}>
				Redo
			</Button>
			<Toggle bind:checked={readonly} label="Read only" />
			<Toggle bind:checked={show_json} label="JSON" />
		</div>
	</header>

	{#if !readonly}
		<div class="toolbar">
			<Toolbar {editor} />
		</div>
	{/if}

	<div class="surface">
		<Editor {editor} {readonly} />
	</div>

	{#if show_json}
		<pre class="json">{JSON.stringify(editor.doc, null, 2)}</pre>
	{/if}
</main>

<style>
	main {
		max-width: 46rem;
		margin-inline: auto;
		padding: 2rem 1rem 6rem;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-block-end: 1.5rem;

		h1 {
			font-size: 1.1rem;
			font-family: var(--font-mono, monospace);
			margin: 0;
		}
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.status {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
	}

	.toolbar {
		position: sticky;
		top: 0.5rem;
		z-index: 10;
		margin-block-end: 0.75rem;
	}

	.surface {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 12px);
		padding: 1rem 1.5rem;
		min-height: 20rem;
	}

	.json {
		margin-block-start: 1.5rem;
		background: var(--color-bg-muted);
		border-radius: var(--radius, 8px);
		padding: 1rem;
		font-size: 0.75rem;
		overflow-x: auto;
		max-height: 30rem;
		overflow-y: auto;
	}
</style>
