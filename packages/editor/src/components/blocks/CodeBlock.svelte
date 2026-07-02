<script lang="ts">
	import { Button, Code, Select } from '@delightstack/components';
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
	let copied_timeout: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(copied_timeout));

	// Read-only mode renders the design system's Code component (syntax
	// highlighting, its own copy button) instead of the editable plain block.
	const code_text = $derived.by(() => {
		if (editable) return '';
		void editor.doc;
		const position = pos();
		if (position === undefined) return '';
		return editor.state.doc.nodeAt(position)?.textContent ?? '';
	});

	async function copy() {
		const position = pos();
		if (position === undefined) return;
		const node = editor.state.doc.nodeAt(position);
		if (!node) return;
		await navigator.clipboard.writeText(node.textContent);
		copied = true;
		clearTimeout(copied_timeout);
		copied_timeout = setTimeout(() => (copied = false), 1500);
	}
</script>

{#if editable}
	<figure class="code-block">
		<figcaption contenteditable="false">
			<Select
				dense
				size="0"
				class="language-select"
				placeholder="Language"
				value={attrs.language}
				options={language_options}
				onchange={({ value }) => update_attrs({ language: String(value ?? '') })} />
			<Button dense transparent size="0" onclick={copy} tooltip="Copy code">
				{copied ? 'Copied' : 'Copy'}
			</Button>
		</figcaption>
		<pre><code {@attach content}></code></pre>
	</figure>
{:else}
	<div class="readonly" contenteditable="false">
		<Code
			code={code_text}
			language={attrs.language || 'plaintext'}
			show_line_numbers={false} />
	</div>
{/if}

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
