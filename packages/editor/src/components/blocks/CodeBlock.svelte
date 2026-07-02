<script lang="ts">
	import { Button, Select } from '@delightstack/components';
	import type { BlockProps } from '../../types/index.js';

	type CodeAttrs = { language: string; block_id: string | null };

	let { attrs, editable, editor, pos, update_attrs, content }: BlockProps<CodeAttrs> =
		$props();

	const LANGUAGES = [
		'',
		'bash',
		'c',
		'cpp',
		'css',
		'go',
		'html',
		'java',
		'javascript',
		'json',
		'markdown',
		'python',
		'rust',
		'sql',
		'svelte',
		'swift',
		'typescript',
		'yaml',
	];

	const language_options = LANGUAGES.map((language) => ({
		value: language,
		label: language === '' ? 'plain text' : language,
	}));

	let copied = $state(false);

	async function copy() {
		const position = pos();
		if (position === undefined) return;
		const node = editor.state.doc.nodeAt(position);
		if (!node) return;
		await navigator.clipboard.writeText(node.textContent);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<figure class="code-block">
	<figcaption contenteditable="false">
		{#if editable}
			<Select
				dense
				size="0"
				class="language-select"
				placeholder="Language"
				value={attrs.language}
				options={language_options}
				onchange={({ value }) => update_attrs({ language: String(value ?? '') })} />
		{:else}
			<span class="language">{attrs.language || 'plain text'}</span>
		{/if}
		<Button dense transparent size="0" onclick={copy} tooltip="Copy code">
			{copied ? 'Copied' : 'Copy'}
		</Button>
	</figcaption>
	<pre><code {@attach content}></code></pre>
</figure>

<style>
	.code-block {
		margin: 0;
		background: var(--color-bg-muted);
		border-radius: var(--radius, 8px);
		overflow: hidden;

		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius, 8px) * var(--squircle-ratio, 2));
		}
	}

	figcaption {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		border-block-end: 1px solid
			var(--color-border, color-mix(in oklab, currentColor 10%, transparent));
		color: var(--color-text-muted);
		user-select: none;

		:global(.language-select) {
			inline-size: 9rem;
			font-family: var(--font-mono, ui-monospace, monospace);
		}
	}

	.language {
		font-size: 0.75rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		color: var(--color-text-muted);
		padding: 0.25rem;
	}

	pre {
		margin: 0;
		padding: 0.75em 1em;
		overflow-x: auto;
		font-size: 0.875em;
		tab-size: 2;

		code {
			display: block;
			font-family: var(--font-mono, ui-monospace, monospace);
			white-space: pre;
		}
	}
</style>
