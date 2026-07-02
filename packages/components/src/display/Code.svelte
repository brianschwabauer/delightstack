<script lang="ts">
	import { scrollbar } from '../actions/scrollbar';
	import { tokenizeLine } from './code-tokens.js';

	const propId = $props.id();
	let {
		/** Code string to display */
		code,

		/** Language for syntax highlighting */
		language = 'plaintext',

		/** Filename displayed in the header */
		filename = undefined as string | undefined,

		/** Whether to show line numbers */
		show_line_numbers = true,

		/** Whether to show the copy button */
		show_copy = true,

		/** Starting line number */
		start_line = 1,

		/** Line numbers to highlight */
		highlight_lines = [] as number[],

		/** Render as unified diff */
		diff = false,

		/** Wrap long lines instead of scrolling */
		wrap = false,

		/** Maximum height with overflow scroll */
		max_height = undefined as string | undefined,

		/** Show loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',
	}: {
		code: string;
		language?: string;
		filename?: string;
		show_line_numbers?: boolean;
		show_copy?: boolean;
		start_line?: number;
		highlight_lines?: number[];
		diff?: boolean;
		wrap?: boolean;
		max_height?: string;
		skeleton?: boolean;
		id?: string;
		class?: string;
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Copy to clipboard                                                  */
	/* ------------------------------------------------------------------ */

	let copy_state = $state<'idle' | 'copied'>('idle');
	let copy_timeout = 0;

	function handleCopy() {
		navigator.clipboard.writeText(code).then(() => {
			copy_state = 'copied';
			if (copy_timeout) clearTimeout(copy_timeout);
			copy_timeout = setTimeout(() => {
				copy_state = 'idle';
			}, 2000) as unknown as number;
		});
	}

	$effect(() => {
		return () => {
			if (copy_timeout) clearTimeout(copy_timeout);
		};
	});

	/* ------------------------------------------------------------------ */
	/*  Derived state                                                      */
	/* ------------------------------------------------------------------ */

	const lines = $derived(code.split('\n'));

	const tokenized_lines = $derived(lines.map((line) => tokenizeLine(line, language)));

	const highlight_set = $derived(new Set(highlight_lines));

	const show_header = $derived(!!filename || show_copy);

	function getDiffClass(line: string): string {
		if (line.startsWith('@@')) return 'diff-section';
		if (line.startsWith('+')) return 'diff-add';
		if (line.startsWith('-')) return 'diff-remove';
		return '';
	}
</script>

{#if skeleton}
	<div
		class={['code skeleton', class_name].filter(Boolean).join(' ')}
		{id}
		aria-hidden="true">
		{#if show_header}
			<div class="header">
				<div class="skeleton-filename"></div>
				{#if show_copy}
					<div class="skeleton-copy"></div>
				{/if}
			</div>
		{/if}
		<div class="skeleton-body">
			{#each { length: 5 } as _, i}
				<div
					class="skeleton-line"
					style:width="{40 + ((i * 37) % 50)}%"
					style:--shimmer-delay="{i * 120}ms">
				</div>
			{/each}
		</div>
	</div>
{:else}
	<div class={['code', class_name].filter(Boolean).join(' ')} class:wrap {id}>
		{#if show_header}
			<div class="header">
				{#if filename}
					<span class="filename">{filename}</span>
				{:else}
					<span></span>
				{/if}
				{#if show_copy}
					<button
						type="button"
						onclick={handleCopy}
						aria-label={copy_state === 'copied' ? 'Copied' : 'Copy code'}>
						{#if copy_state === 'copied'}
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								aria-hidden="true">
								<path
									d="M3 8.5L6.5 12L13 4"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round" />
							</svg>
						{:else}
							<svg
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="none"
								aria-hidden="true">
								<rect
									x="5.5"
									y="5.5"
									width="8"
									height="8"
									rx="1.5"
									stroke="currentColor"
									stroke-width="1.25" />
								<path
									d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5"
									stroke="currentColor"
									stroke-width="1.25" />
							</svg>
						{/if}
					</button>
				{/if}
			</div>
		{/if}

		<div class="body" style:max-height={max_height} {@attach scrollbar()}>
			<pre><code>{#each tokenized_lines as tokens, i}{@const line_num =
							start_line + i}{@const is_highlighted =
							highlight_set.has(line_num)}{@const raw_line = lines[i]}<span
							class="line"
							class:highlighted={is_highlighted}
							class:diff-add={diff && getDiffClass(raw_line) === 'diff-add'}
							class:diff-remove={diff && getDiffClass(raw_line) === 'diff-remove'}
							class:diff-section={diff &&
								getDiffClass(raw_line) === 'diff-section'}>{#if show_line_numbers}<span
									class="number"
									class:highlighted={is_highlighted}
									aria-hidden="true">{line_num}</span>{/if}<span
								class="content">{#each tokens as token}<span
										class="token-{token.type}">{token.content}</span>{/each}</span>
</span>{/each}</code></pre>
		</div>
	</div>
{/if}

<style>
	/* ========== Container ========== */

	.code {
		border-radius: var(--radius-lg, 0.5rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
		}
		border: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		background: var(--color-bg-muted, light-dark(#f8fafc, #1e293b));
		overflow: hidden;
		font-family:
			ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas,
			'DejaVu Sans Mono', monospace;
		font-size: 0.875rem;
		line-height: 1.6;

		&.wrap .content {
			white-space: pre-wrap;
			word-break: break-all;
		}

		&.skeleton {
			pointer-events: none;
			/* The %-width placeholder lines have no intrinsic width, so in a
			   flex/grid parent the skeleton would collapse to the filename bar —
			   fill the container instead (the real block's natural max). */
			width: 100%;
		}
	}

	/* ========== Header (shared by the real block and the skeleton) ========== */

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border, light-dark(#e2e8f0, #334155));
		background: var(--color-bg-4, light-dark(#f1f5f9, #1a2332));
		min-height: 2rem;

		/* The copy button — the component's only <button> */
		button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 1.75rem;
			height: 1.75rem;
			padding: 0;
			border: none;
			border-radius: var(--radius-lg, 0.5rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
			}
			background: transparent;
			color: light-dark(#64748b, #94a3b8);
			cursor: pointer;
			flex-shrink: 0;
			transition:
				color 150ms ease,
				background 150ms ease;

			&:hover {
				background: light-dark(rgb(0 0 0 / 0.06), rgb(255 255 255 / 0.08));
				color: light-dark(#334155, #e2e8f0);
				transition: none;
			}

			&:active {
				background: light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.12));
			}

			&:focus-visible {
				outline: 2px solid var(--color-action, #3b82f6);
				outline-offset: -2px;
			}
		}
	}

	.filename {
		font-size: 0.8125rem;
		color: light-dark(#475569, #94a3b8);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	/* ========== Code Body ========== */

	.body {
		overflow: auto;

		pre {
			margin: 0;
			padding: 0;
		}

		code {
			display: block;
			padding: 0.75rem 0;
		}
	}

	/* ========== Lines ========== */

	.line {
		display: flex;
		min-height: 1.6em;

		/* Lines without line numbers need left padding */
		&:not(:has(.number)) .content {
			padding-left: 1rem;
		}

		&.highlighted {
			background: light-dark(
				rgb(from var(--color-action, #3b82f6) r g b / 0.08),
				rgb(from var(--color-action, #3b82f6) r g b / 0.12)
			);
		}

		&.diff-add {
			background: light-dark(
				rgb(from var(--color-success, #22c55e) r g b / 0.1),
				rgb(from var(--color-success, #22c55e) r g b / 0.12)
			);
		}

		&.diff-remove {
			background: light-dark(
				rgb(from var(--color-error, #ef4444) r g b / 0.1),
				rgb(from var(--color-error, #ef4444) r g b / 0.12)
			);
		}

		&.diff-section {
			background: light-dark(
				rgb(from var(--color-action, #3b82f6) r g b / 0.06),
				rgb(from var(--color-action, #3b82f6) r g b / 0.08)
			);
			color: light-dark(#6b7280, #9ca3af);
			font-style: italic;
		}
	}

	.number {
		display: inline-block;
		width: 3.5rem;
		padding-right: 1rem;
		text-align: right;
		color: light-dark(#94a3b8, #475569);
		user-select: none;
		flex-shrink: 0;
		box-sizing: border-box;

		&.highlighted {
			color: var(--color-action, #3b82f6);
		}
	}

	.content {
		flex: 1;
		min-width: 0;
		padding-right: 1rem;
		white-space: pre;
	}

	/* ========== Token Colors ========== */

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
		background: light-dark(rgb(0 0 0 / 0.04), rgb(255 255 255 / 0.06));
		border-radius: 3px;
		padding: 0 0.25em;
	}

	.token-link {
		color: light-dark(#2563eb, #60a5fa);
		text-decoration: underline;
	}

	.token-plain {
		color: inherit;
	}

	/* ========== Skeleton ========== */

	.skeleton-filename,
	.skeleton-copy,
	.skeleton-line {
		position: relative;
		overflow: hidden;
		background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));
		border-radius: var(--radius-full, 1e5px);

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				105deg,
				transparent 25%,
				var(--skeleton-sheen, rgb(from var(--color-text, #888) r g b / 0.12)) 50%,
				transparent 75%
			);
			animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
				infinite;
			animation-delay: var(--shimmer-delay, 0s);
		}
	}

	/* Filename text-line at the real .filename size (0.8125rem), padded
	   out to its 1lh line box so the bar occupies the real text's height. */
	.skeleton-filename {
		font-size: 0.8125rem;
		height: 0.7em;
		margin-block: calc((1lh - 0.7em) / 2);
		width: 6rem;
	}

	/* Stands in for the 1.75rem copy button — it's what sets the real
	   header's content height. */
	.skeleton-copy {
		width: 1.75rem;
		height: 1.75rem;
		flex-shrink: 0;
		border-radius: var(--radius-lg, 0.5rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
		}
	}

	/* Matches the real code block: `code` has 0.75rem block padding, lines are
	   padded 1rem left and stack at 1lh (line-height 1.6 on .code). */
	.skeleton-body {
		padding: 0.75rem 1rem;
		/* Flex column so the line margins don't collapse between bars. */
		display: flex;
		flex-direction: column;
	}

	/* Each placeholder occupies exactly one code line: the 0.7em bar is padded
	   out to 1lh by its margins, so five bars equal five real lines. */
	.skeleton-line {
		height: 0.7em;
		margin-block: calc((1lh - 0.7em) / 2);
	}

	@keyframes -global-delight-skeleton-shimmer {
		0% {
			transform: translateX(-100%);
		}
		55%,
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-filename::after,
		.skeleton-copy::after,
		.skeleton-line::after {
			animation: none;
		}
	}
</style>
