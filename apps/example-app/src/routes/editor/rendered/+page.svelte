<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Rendered document</title>
</svelte:head>

<main>
	<header>
		<h1>renderHTML output</h1>
		<a href="/editor">← back to the editor</a>
	</header>

	<article class="doc">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- output of the trusted server renderer -->
		{@html data.html}
	</article>

	<h2>renderText output</h2>
	<pre>{data.text}</pre>
</main>

<style>
	main {
		max-width: 46rem;
		margin-inline: auto;
		padding: 2rem 1rem 6rem;
	}

	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-block-end: 1.5rem;

		h1 {
			font-size: 1.1rem;
			font-family: var(--font-mono, monospace);
			margin: 0;
		}

		a {
			font-size: 0.875rem;
			color: var(--action, var(--color-primary));
		}
	}

	.doc {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg, 12px);
		padding: 1rem 1.5rem;
		line-height: 1.6;

		:global {
			.ds-doc-callout {
				padding: 0.875em 1em;
				border-radius: var(--radius, 8px);
				border-inline-start: 3px solid var(--action, var(--color-primary));
				background: color-mix(
					in oklab,
					var(--action, var(--color-primary)) 9%,
					transparent
				);
			}

			.ds-doc-code {
				background: var(--color-bg-muted);
				border-radius: var(--radius, 8px);
				padding: 0.75em 1em;
				overflow-x: auto;
				font-size: 0.875em;
			}

			ul[data-todo-list] {
				list-style: none;
				padding-inline-start: 0.5em;
			}

			li[data-todo='checked'] {
				text-decoration: line-through;
				color: var(--color-text-muted);
			}

			> * + * {
				margin-block-start: 0.625em;
			}
		}
	}

	h2 {
		font-size: 0.9rem;
		font-family: var(--font-mono, monospace);
		margin-block: 2rem 0.5rem;
	}

	pre {
		background: var(--color-bg-muted);
		border-radius: var(--radius, 8px);
		padding: 1rem;
		font-size: 0.8125rem;
		white-space: pre-wrap;
	}
</style>
