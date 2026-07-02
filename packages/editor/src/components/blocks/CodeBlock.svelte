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

	/* Token colors for the live-highlight decorations — mirrors the design
	   system's Code.svelte token theme so editable and read-only match */
	.code-block :global {
		.token-keyword {
			color: light-dark(#7c3aed, #a78bfa);
		}
		.token-string {
			color: light-dark(#059669, #34d399);
		}
		.token-comment {
			color: light-dark(#6b7280, #9ca3af);
			font-style: italic;
		}
		.token-function {
			color: light-dark(#2563eb, #60a5fa);
		}
		.token-number {
			color: light-dark(#d97706, #fbbf24);
		}
		.token-operator {
			color: light-dark(#6b7280, #cbd5e1);
		}
		.token-tag {
			color: light-dark(#dc2626, #f87171);
		}
		.token-attribute {
			color: light-dark(#d97706, #fbbf24);
		}
		.token-property {
			color: light-dark(#2563eb, #60a5fa);
		}
		.token-value {
			color: light-dark(#059669, #34d399);
		}
		.token-variable {
			color: light-dark(#d97706, #fbbf24);
		}
		.token-decorator {
			color: light-dark(#d97706, #fbbf24);
			font-style: italic;
		}
		.token-heading {
			color: light-dark(#7c3aed, #a78bfa);
			font-weight: 700;
		}
		.token-bold {
			font-weight: 700;
		}
		.token-italic {
			font-style: italic;
		}
		.token-code {
			color: light-dark(#059669, #34d399);
		}
		.token-link {
			color: light-dark(#2563eb, #60a5fa);
			text-decoration: underline;
		}
	}
</style>
