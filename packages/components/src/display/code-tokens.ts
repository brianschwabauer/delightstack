/**
 * Shared line tokenizer for syntax highlighting: used by the `Code`
 * display component and by `@delightstack/editor`'s editable code-block
 * decorations, so both render identical tokens (`token-<type>` classes).
 */

export interface Token {
	type: string;
	content: string;
}

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

export function tokenizeLine(line: string, lang: string): Token[] {
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

