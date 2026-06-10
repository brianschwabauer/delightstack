<script lang="ts">
	interface Token {
		type: string;
		content: string;
	}

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
	/*  Built-in tokenizers                                                */
	/* ------------------------------------------------------------------ */

	function tokenizePlain(line: string): Token[] {
		return line ? [{ type: 'plain', content: line }] : [{ type: 'plain', content: '' }];
	}

	function tokenizeByPatterns(line: string, patterns: [RegExp, string][]): Token[] {
		const tokens: Token[] = [];
		let remaining = line;

		while (remaining.length > 0) {
			let earliest_match: {
				index: number;
				length: number;
				type: string;
				text: string;
			} | null = null;

			for (const [regex, type] of patterns) {
				regex.lastIndex = 0;
				const m = regex.exec(remaining);
				if (m && (earliest_match === null || m.index < earliest_match.index)) {
					earliest_match = { index: m.index, length: m[0].length, type, text: m[0] };
				}
			}

			if (earliest_match === null) {
				tokens.push({ type: 'plain', content: remaining });
				break;
			}

			if (earliest_match.index > 0) {
				tokens.push({ type: 'plain', content: remaining.slice(0, earliest_match.index) });
			}

			tokens.push({ type: earliest_match.type, content: earliest_match.text });
			remaining = remaining.slice(earliest_match.index + earliest_match.length);
		}

		return tokens.length ? tokens : [{ type: 'plain', content: '' }];
	}

	const js_keywords =
		/\b(abstract|arguments|async|await|boolean|break|byte|case|catch|char|class|const|continue|debugger|default|delete|do|double|else|enum|export|extends|final|finally|float|for|from|function|goto|if|implements|import|in|instanceof|int|interface|let|long|native|new|null|of|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|try|typeof|undefined|var|void|volatile|while|with|yield|true|false)\b/g;

	const ts_keywords =
		/\b(abstract|arguments|as|async|await|boolean|break|byte|case|catch|char|class|const|continue|debugger|declare|default|delete|do|double|else|enum|export|extends|final|finally|float|for|from|function|goto|if|implements|import|in|infer|instanceof|int|interface|is|keyof|let|long|module|namespace|native|never|new|null|of|package|private|protected|public|readonly|return|short|static|string|number|super|switch|synchronized|this|throw|throws|transient|try|type|typeof|undefined|unknown|var|void|volatile|while|with|yield|true|false)\b/g;

	function tokenizeJS(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/\/\/.*$/g, 'comment'],
			[/\/\*.*?\*\//g, 'comment'],
			[/`(?:[^`\\]|\\.)*`/g, 'string'],
			[/"(?:[^"\\]|\\.)*"/g, 'string'],
			[/'(?:[^'\\]|\\.)*'/g, 'string'],
			[/\b\d+\.?\d*(?:e[+-]?\d+)?\b/gi, 'number'],
			[/\b[A-Za-z_$][\w$]*(?=\s*\()/g, 'function'],
			[js_keywords, 'keyword'],
			[/[+\-*/%=!<>&|^~?:]+/g, 'operator'],
		]);
	}

	function tokenizeTS(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/\/\/.*$/g, 'comment'],
			[/\/\*.*?\*\//g, 'comment'],
			[/`(?:[^`\\]|\\.)*`/g, 'string'],
			[/"(?:[^"\\]|\\.)*"/g, 'string'],
			[/'(?:[^'\\]|\\.)*'/g, 'string'],
			[/\b\d+\.?\d*(?:e[+-]?\d+)?\b/gi, 'number'],
			[/\b[A-Za-z_$][\w$]*(?=\s*\()/g, 'function'],
			[ts_keywords, 'keyword'],
			[/[+\-*/%=!<>&|^~?:]+/g, 'operator'],
		]);
	}

	function tokenizeHTML(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/<!--.*?-->/g, 'comment'],
			[/"[^"]*"/g, 'string'],
			[/'[^']*'/g, 'string'],
			[/<\/?[\w-]+/g, 'tag'],
			[/\/?>/g, 'tag'],
			[/\b[\w-]+(?==)/g, 'attribute'],
		]);
	}

	function tokenizeCSS(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/\/\*.*?\*\//g, 'comment'],
			[/\/\/.*$/g, 'comment'],
			[/"(?:[^"\\]|\\.)*"/g, 'string'],
			[/'(?:[^'\\]|\\.)*'/g, 'string'],
			[/\b\d+\.?\d*(?:px|em|rem|%|vh|vw|vmin|vmax|deg|s|ms|fr|ch|ex)?\b/g, 'number'],
			[/@[\w-]+/g, 'keyword'],
			[/[.#][\w-]+/g, 'variable'],
			[/[\w-]+(?=\s*:)/g, 'property'],
			[/:\s*[^;{}]+/g, 'value'],
		]);
	}

	function tokenizeJSON(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/"(?:[^"\\]|\\.)*"(?=\s*:)/g, 'property'],
			[/"(?:[^"\\]|\\.)*"/g, 'string'],
			[/\b\d+\.?\d*(?:e[+-]?\d+)?\b/gi, 'number'],
			[/\b(true|false)\b/g, 'keyword'],
			[/\bnull\b/g, 'keyword'],
		]);
	}

	const python_keywords =
		/\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g;

	function tokenizePython(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/#.*$/g, 'comment'],
			[/""".*?"""/g, 'string'],
			[/'''.*?'''/g, 'string'],
			[/f"(?:[^"\\]|\\.)*"/g, 'string'],
			[/f'(?:[^'\\]|\\.)*'/g, 'string'],
			[/"(?:[^"\\]|\\.)*"/g, 'string'],
			[/'(?:[^'\\]|\\.)*'/g, 'string'],
			[/@[\w.]+/g, 'decorator'],
			[/\b\d+\.?\d*(?:e[+-]?\d+)?j?\b/gi, 'number'],
			[/\b[A-Za-z_]\w*(?=\s*\()/g, 'function'],
			[python_keywords, 'keyword'],
			[/[+\-*/%=!<>&|^~@:]+/g, 'operator'],
		]);
	}

	function tokenizeBash(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/#.*$/g, 'comment'],
			[/"(?:[^"\\]|\\.)*"/g, 'string'],
			[/'[^']*'/g, 'string'],
			[/\$\{[^}]*\}/g, 'variable'],
			[/\$[\w]+/g, 'variable'],
			[/\b\d+\.?\d*\b/g, 'number'],
			[
				/\b(alias|bg|bind|break|builtin|caller|case|cd|command|compgen|complete|continue|declare|dirs|disown|do|done|echo|elif|else|enable|esac|eval|exec|exit|export|false|fc|fg|fi|for|function|getopts|hash|help|history|if|in|jobs|kill|let|local|logout|popd|printf|pushd|pwd|read|readonly|return|select|set|shift|shopt|source|suspend|test|then|time|times|trap|true|type|typeset|ulimit|umask|unalias|unset|until|wait|while)\b/g,
				'keyword',
			],
			[/\b[\w./-]+(?=\s|$)/g, 'function'],
			[/[|&;<>]+/g, 'operator'],
		]);
	}

	const sql_keywords =
		/\b(ADD|ALL|ALTER|AND|ANY|AS|ASC|BACKUP|BETWEEN|BY|CASE|CHECK|COLUMN|CONSTRAINT|CREATE|DATABASE|DEFAULT|DELETE|DESC|DISTINCT|DROP|EACH|ELSE|END|EXEC|EXISTS|FOREIGN|FROM|FULL|GROUP|HAVING|IF|IN|INDEX|INNER|INSERT|INTO|IS|JOIN|KEY|LEFT|LIKE|LIMIT|NOT|NULL|OFFSET|ON|OR|ORDER|OUTER|PRIMARY|PROCEDURE|REFERENCES|REPLACE|RIGHT|ROWNUM|SELECT|SET|TABLE|THEN|TOP|TRUNCATE|UNION|UNIQUE|UPDATE|VALUES|VIEW|WHEN|WHERE|WITH)\b/gi;

	function tokenizeSQL(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/--.*$/g, 'comment'],
			[/\/\*.*?\*\//g, 'comment'],
			[/'(?:[^'\\]|\\.)*'/g, 'string'],
			[/"(?:[^"\\]|\\.)*"/g, 'string'],
			[/\b\d+\.?\d*\b/g, 'number'],
			[/\b[A-Za-z_]\w*(?=\s*\()/g, 'function'],
			[sql_keywords, 'keyword'],
			[/[+\-*/%=!<>&|^~]+/g, 'operator'],
		]);
	}

	function tokenizeSvelte(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/<!--.*?-->/g, 'comment'],
			[/\/\/.*$/g, 'comment'],
			[/\{#[\w]+/g, 'keyword'],
			[/\{\/[\w]+\}/g, 'keyword'],
			[/\{:[\w]+/g, 'keyword'],
			[/`(?:[^`\\]|\\.)*`/g, 'string'],
			[/"(?:[^"\\]|\\.)*"/g, 'string'],
			[/'(?:[^'\\]|\\.)*'/g, 'string'],
			[/\b\d+\.?\d*\b/g, 'number'],
			[/<\/?[\w-]+/g, 'tag'],
			[/\/?>/g, 'tag'],
			[/\b[\w-]+(?==)/g, 'attribute'],
			[/\b[A-Za-z_$][\w$]*(?=\s*\()/g, 'function'],
			[js_keywords, 'keyword'],
			[/[+\-*/%=!<>&|^~?:]+/g, 'operator'],
		]);
	}

	function tokenizeMarkdown(line: string): Token[] {
		return tokenizeByPatterns(line, [
			[/^#{1,6}\s+.*/g, 'heading'],
			[/`[^`]+`/g, 'code'],
			[/\*\*[^*]+\*\*/g, 'bold'],
			[/\*[^*]+\*/g, 'italic'],
			[/__[^_]+__/g, 'bold'],
			[/_[^_]+_/g, 'italic'],
			[/\[([^\]]+)\]\([^)]+\)/g, 'link'],
			[/!\[([^\]]*)\]\([^)]+\)/g, 'link'],
		]);
	}

	function tokenizeLine(line: string, lang: string): Token[] {
		switch (lang) {
			case 'javascript':
			case 'js':
			case 'jsx':
				return tokenizeJS(line);
			case 'typescript':
			case 'ts':
			case 'tsx':
				return tokenizeTS(line);
			case 'html':
			case 'xml':
				return tokenizeHTML(line);
			case 'css':
			case 'scss':
			case 'sass':
			case 'less':
				return tokenizeCSS(line);
			case 'json':
			case 'jsonc':
				return tokenizeJSON(line);
			case 'python':
			case 'py':
				return tokenizePython(line);
			case 'bash':
			case 'sh':
			case 'shell':
			case 'zsh':
				return tokenizeBash(line);
			case 'sql':
				return tokenizeSQL(line);
			case 'svelte':
				return tokenizeSvelte(line);
			case 'markdown':
			case 'md':
				return tokenizeMarkdown(line);
			default:
				return tokenizePlain(line);
		}
	}

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
		<div class="skeleton-header">
			<div class="skeleton-filename"></div>
		</div>
		<div class="skeleton-body">
			{#each { length: 5 } as _, i}
				<div
					class="skeleton-line"
					style:width="{40 + ((i * 37) % 50)}%"
					style:animation-delay="{i * 100}ms">
				</div>
			{/each}
		</div>
	</div>
{:else}
	<div class={['code', class_name].filter(Boolean).join(' ')} class:wrap {id}>
		{#if show_header}
			<div class="code-header">
				{#if filename}
					<span class="code-filename">{filename}</span>
				{:else}
					<span></span>
				{/if}
				{#if show_copy}
					<button
						type="button"
						class="code-copy"
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

		<div class="code-body" style:max-height={max_height}>
			<pre><code>{#each tokenized_lines as tokens, i}{@const line_num =
							start_line + i}{@const is_highlighted =
							highlight_set.has(line_num)}{@const raw_line = lines[i]}<span
							class="code-line"
							class:highlighted={is_highlighted}
							class:diff-add={diff && getDiffClass(raw_line) === 'diff-add'}
							class:diff-remove={diff && getDiffClass(raw_line) === 'diff-remove'}
							class:diff-section={diff &&
								getDiffClass(raw_line) === 'diff-section'}>{#if show_line_numbers}<span
									class="line-number"
									class:highlighted={is_highlighted}
									aria-hidden="true">{line_num}</span>{/if}<span
								class="line-content">{#each tokens as token}<span
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
		border: 1px solid light-dark(#e2e8f0, #334155);
		background: light-dark(#f8fafc, #1e293b);
		overflow: hidden;
		font-family:
			ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas,
			'DejaVu Sans Mono', monospace;
		font-size: 0.875rem;
		line-height: 1.6;
	}

	/* ========== Header ========== */

	.code-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid light-dark(#e2e8f0, #334155);
		background: light-dark(#f1f5f9, #1a2332);
		min-height: 2rem;
	}

	.code-filename {
		font-size: 0.8125rem;
		color: light-dark(#475569, #94a3b8);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.code-copy {
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

	/* ========== Code Body ========== */

	.code-body {
		overflow: auto;
	}

	.code-body pre {
		margin: 0;
		padding: 0;
	}

	.code-body code {
		display: block;
		padding: 0.75rem 0;
	}

	/* ========== Lines ========== */

	.code-line {
		display: flex;
		min-height: 1.6em;
	}

	.code.wrap .line-content {
		white-space: pre-wrap;
		word-break: break-all;
	}

	.line-number {
		display: inline-block;
		width: 3.5rem;
		padding-right: 1rem;
		text-align: right;
		color: light-dark(#94a3b8, #475569);
		user-select: none;
		flex-shrink: 0;
		box-sizing: border-box;
	}

	.line-number.highlighted {
		color: var(--color-action, #3b82f6);
	}

	.line-content {
		flex: 1;
		min-width: 0;
		padding-right: 1rem;
		white-space: pre;
	}

	/* Lines without line numbers need left padding */
	.code-line:not(:has(.line-number)) .line-content {
		padding-left: 1rem;
	}

	/* ========== Highlight ========== */

	.code-line.highlighted {
		background: light-dark(
			rgb(from var(--color-action, #3b82f6) r g b / 0.08),
			rgb(from var(--color-action, #3b82f6) r g b / 0.12)
		);
	}

	/* ========== Diff ========== */

	.code-line.diff-add {
		background: light-dark(
			rgb(from var(--color-success, #22c55e) r g b / 0.1),
			rgb(from var(--color-success, #22c55e) r g b / 0.12)
		);
	}

	.code-line.diff-remove {
		background: light-dark(
			rgb(from var(--color-error, #ef4444) r g b / 0.1),
			rgb(from var(--color-error, #ef4444) r g b / 0.12)
		);
	}

	.code-line.diff-section {
		background: light-dark(
			rgb(from var(--color-action, #3b82f6) r g b / 0.06),
			rgb(from var(--color-action, #3b82f6) r g b / 0.08)
		);
		color: light-dark(#6b7280, #9ca3af);
		font-style: italic;
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

	.code.skeleton {
		pointer-events: none;
		border-radius: var(--radius-lg, 0.5rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
		}
		border: 1px solid light-dark(#e2e8f0, #334155);
		background: light-dark(#f8fafc, #1e293b);
		overflow: hidden;
	}

	.skeleton-header {
		display: flex;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid light-dark(#e2e8f0, #334155);
		background: light-dark(#f1f5f9, #1a2332);
		min-height: 2rem;
	}

	.skeleton-filename {
		height: 0.75rem;
		width: 6rem;
		border-radius: var(--radius-lg, 0.5rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
		}
		background: light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: code-shimmer 2s infinite;
		}
	}

	.skeleton-body {
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.skeleton-line {
		height: 0.875rem;
		border-radius: var(--radius-lg, 0.5rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
		}
		background: light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: code-shimmer 2s infinite;
		}
	}

	@keyframes code-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-filename::after,
		.skeleton-line::after {
			animation: none;
		}
	}
</style>
