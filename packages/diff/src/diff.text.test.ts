import { describe, expect, it } from 'vitest';
import { diffLines, diffWords, tokenizeLines, tokenizeWords, type DiffOp } from './diff.text';

/** Rebuild the old text from the ops. */
function oldText(ops: DiffOp[]): string {
	return ops
		.filter((op) => op.type !== 'insert')
		.map((op) => op.text)
		.join('');
}

/** Rebuild the new text from the ops. */
function newText(ops: DiffOp[]): string {
	return ops
		.filter((op) => op.type !== 'delete')
		.map((op) => op.text)
		.join('');
}

function expectWellFormed(ops: DiffOp[], old_text: string, new_text: string): void {
	expect(oldText(ops)).toBe(old_text);
	expect(newText(ops)).toBe(new_text);
	for (const op of ops) expect(op.text).not.toBe('');
	for (let i = 1; i < ops.length; i++) expect(ops[i].type).not.toBe(ops[i - 1].type);
	// Within a changed region, delete comes before insert.
	for (let i = 1; i < ops.length; i++) {
		if (ops[i].type === 'delete') expect(ops[i - 1].type).not.toBe('insert');
	}
}

/** Deterministic PRNG (mulberry32) — no Math.random anywhere in this suite. */
function makeRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('tokenizeWords', () => {
	it('is lossless', () => {
		const samples = [
			'',
			'hello world',
			'  leading and trailing  ',
			'# Heading\n\nA paragraph with *emphasis*, a [link](https://example.com), and `code`.\n',
			"don't — it's Brian's",
			'naïve café résumé',
			'你好世界，这是中文。',
			'🎉 party 👩‍👩‍👧‍👦 family 🇺🇸 flag 👍🏽 thumb',
			'\r\n\t mixed   whitespace \n\n',
		];
		for (const sample of samples) expect(tokenizeWords(sample).join('')).toBe(sample);
	});

	it('splits words, whitespace and punctuation separately', () => {
		expect(tokenizeWords('Hello, world!')).toEqual(['Hello', ',', ' ', 'world', '!']);
	});

	it('keeps intra-word apostrophes inside the word', () => {
		expect(tokenizeWords("don't")).toEqual(["don't"]);
		expect(tokenizeWords('it’s')).toEqual(['it’s']);
	});

	it('splits CJK per character (no word separators in the script)', () => {
		expect(tokenizeWords('你好世界')).toEqual(['你', '好', '世', '界']);
		expect(tokenizeWords('日本語のテキスト')).toEqual(['日', '本', '語', 'の', 'テ', 'キ', 'ス', 'ト']);
	});

	it('keeps emoji grapheme clusters whole', () => {
		expect(tokenizeWords('👩‍👩‍👧‍👦')).toEqual(['👩‍👩‍👧‍👦']);
		expect(tokenizeWords('👍🏽')).toEqual(['👍🏽']);
		expect(tokenizeWords('🇺🇸')).toEqual(['🇺🇸']);
		expect(tokenizeWords('a🎉b')).toEqual(['a', '🎉', 'b']);
	});
});

describe('diffWords — degenerate inputs', () => {
	it('handles two empty strings', () => {
		expect(diffWords('', '')).toEqual([]);
	});

	it('handles an empty old text', () => {
		const ops = diffWords('', 'hello world');
		expect(ops).toEqual([{ type: 'insert', text: 'hello world' }]);
		expectWellFormed(ops, '', 'hello world');
	});

	it('handles an empty new text', () => {
		const ops = diffWords('hello world', '');
		expect(ops).toEqual([{ type: 'delete', text: 'hello world' }]);
		expectWellFormed(ops, 'hello world', '');
	});

	it('returns a single equal op for identical inputs', () => {
		const text = 'The quick brown fox jumps over the lazy dog.';
		expect(diffWords(text, text)).toEqual([{ type: 'equal', text }]);
	});

	it('handles a complete replacement with no shared tokens', () => {
		const ops = diffWords('alpha beta gamma', 'delta epsilon zeta');
		expectWellFormed(ops, 'alpha beta gamma', 'delta epsilon zeta');
		// Whitespace tokens are shared, so a few equal spans are expected; the
		// point is that no source word survives.
		const equal_words = ops
			.filter((op) => op.type === 'equal')
			.map((op) => op.text)
			.join('')
			.trim();
		expect(equal_words).toBe('');
	});

	it('handles pure insertion at the end', () => {
		const ops = diffWords('one two', 'one two three');
		expect(ops).toEqual([
			{ type: 'equal', text: 'one two' },
			{ type: 'insert', text: ' three' },
		]);
	});

	it('handles pure deletion at the start', () => {
		const ops = diffWords('one two three', 'two three');
		expectWellFormed(ops, 'one two three', 'two three');
		expect(ops[0]).toEqual({ type: 'delete', text: 'one ' });
	});
});

describe('diffWords — realistic prose edit', () => {
	const old_text = [
		'The harbour was quiet that morning, and the boats sat still against the pier.',
		'Marta walked the length of the boardwalk twice before she found the right door.',
		'Inside, the smell of coffee and diesel argued with each other for the room.',
	].join(' ');

	const new_text = [
		'The harbour was quiet that morning, and the boats sat still against the pier.',
		'Marta paced the boardwalk three times before she found the right door.',
		'Inside, the smell of coffee and diesel argued with each other for the room.',
	].join(' ');

	const ops = diffWords(old_text, new_text);

	it('round-trips both texts', () => {
		expectWellFormed(ops, old_text, new_text);
	});

	it('preserves the untouched sentences as equal spans', () => {
		const equal_text = ops
			.filter((op) => op.type === 'equal')
			.map((op) => op.text)
			.join('');
		expect(equal_text).toContain('The harbour was quiet that morning, and the boats sat still against the pier.');
		expect(equal_text).toContain('Inside, the smell of coffee and diesel argued with each other for the room.');
		expect(equal_text).toContain('before she found the right door.');
		expect(equal_text).toContain('Marta ');
	});

	it('produces a small, human-readable diff', () => {
		expect(ops.length).toBeLessThanOrEqual(9);

		const deleted = ops
			.filter((op) => op.type === 'delete')
			.map((op) => op.text)
			.join('|');
		const inserted = ops
			.filter((op) => op.type === 'insert')
			.map((op) => op.text)
			.join('|');

		expect(deleted).toContain('walked');
		expect(deleted).toContain('twice');
		expect(inserted).toContain('paced');
		expect(inserted).toContain('three times');

		// Only the reworded clause changes: well under a fifth of the document.
		const changed_length = deleted.length + inserted.length;
		expect(changed_length).toBeLessThan(old_text.length / 3);
	});

	it('reduces pure reflow to a tiny local change', () => {
		// Same words, different wrapping. A line diff would report both lines as
		// changed; the word diff touches only the whitespace around one word.
		// (Moving a newline across a word is genuinely ambiguous at equal edit cost,
		// so the one adjacent word may appear in the diff — nothing beyond that.)
		const wrapped_old = 'The quick brown fox\njumps over the lazy dog.';
		const wrapped_new = 'The quick brown\nfox jumps over the lazy dog.';
		const reflow_ops = diffWords(wrapped_old, wrapped_new);
		expectWellFormed(reflow_ops, wrapped_old, wrapped_new);

		const changed_length = reflow_ops
			.filter((op) => op.type !== 'equal')
			.map((op) => op.text.length)
			.reduce((total, length) => total + length, 0);
		expect(changed_length).toBeLessThanOrEqual(10);
		expect(reflow_ops.length).toBeLessThanOrEqual(6);

		// The rest of the sentence is untouched.
		const equal_text = reflow_ops
			.filter((op) => op.type === 'equal')
			.map((op) => op.text)
			.join('');
		expect(equal_text).toContain('The quick brown');
		expect(equal_text).toContain('jumps over the lazy dog.');
	});
});

describe('diffWords — markdown structure', () => {
	it('keeps unchanged headings and list items equal', () => {
		const old_text = '# Notes\n\n- first item\n- second item\n- third item\n';
		const new_text = '# Notes\n\n- first item\n- second item revised\n- third item\n';
		const ops = diffWords(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops.filter((op) => op.type === 'delete')).toHaveLength(0);
		expect(ops.filter((op) => op.type === 'insert').map((op) => op.text)).toEqual([' revised']);
	});
});

describe('diffWords — unicode', () => {
	it('diffs CJK per character', () => {
		const old_text = '这是一个测试。';
		const new_text = '这是两个测试。';
		const ops = diffWords(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops).toEqual([
			{ type: 'equal', text: '这是' },
			{ type: 'delete', text: '一' },
			{ type: 'insert', text: '两' },
			{ type: 'equal', text: '个测试。' },
		]);
	});

	it('treats an emoji cluster as one atomic token', () => {
		const old_text = 'ship it 🚀 today';
		const new_text = 'ship it 🎉 today';
		const ops = diffWords(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops.filter((op) => op.type === 'delete').map((op) => op.text)).toEqual(['🚀']);
		expect(ops.filter((op) => op.type === 'insert').map((op) => op.text)).toEqual(['🎉']);
	});

	it('does not split a ZWJ sequence or a skin-tone modifier', () => {
		const old_text = 'hello 👩‍👩‍👧‍👦 and 👍🏽';
		const new_text = 'hello 👩‍👩‍👧‍👦 and 👍🏻';
		const ops = diffWords(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops.filter((op) => op.type === 'delete').map((op) => op.text)).toEqual(['👍🏽']);
		expect(ops.filter((op) => op.type === 'insert').map((op) => op.text)).toEqual(['👍🏻']);
	});

	it('handles combining marks inside words', () => {
		const old_text = 'a café in Paris';
		const new_text = 'a café in Lyon';
		const ops = diffWords(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops[0].type).toBe('equal');
		expect(ops[0].text).toContain('café');
	});
});

describe('diffWords — randomized round-trip property', () => {
	const WORDS = [
		'the', 'harbour', 'quiet', 'morning', 'boats', 'still', 'pier', 'Marta', 'walked',
		'boardwalk', 'twice', 'door', 'coffee', 'diesel', 'argued', 'room', 'light', 'salt',
		'你好', '世界', '🎉', '👍🏽', 'café', 'naïve', 'a', 'b',
	];
	const PUNCTUATION = ['.', ',', '!', '?', ';', ':', '—', ')', '('];
	const GAPS = [' ', '  ', '\n', '\n\n', '\t'];

	function randomText(random: () => number, max_words: number): string {
		const count = Math.floor(random() * max_words);
		let text = '';
		for (let i = 0; i < count; i++) {
			text += WORDS[Math.floor(random() * WORDS.length)];
			if (random() < 0.15) text += PUNCTUATION[Math.floor(random() * PUNCTUATION.length)];
			if (i < count - 1) text += GAPS[Math.floor(random() * GAPS.length)];
		}
		return text;
	}

	/** Derive a new text from an old one by scattered edits, so the pair is realistic. */
	function mutate(random: () => number, text: string): string {
		const tokens = tokenizeWords(text);
		const edits = Math.floor(random() * 6);
		for (let i = 0; i < edits; i++) {
			if (tokens.length === 0) break;
			const index = Math.floor(random() * tokens.length);
			const roll = random();
			if (roll < 0.34) tokens.splice(index, 1);
			else if (roll < 0.67) tokens.splice(index, 0, WORDS[Math.floor(random() * WORDS.length)]);
			else tokens[index] = WORDS[Math.floor(random() * WORDS.length)];
		}
		return tokens.join('');
	}

	it('round-trips 250 randomized pairs', () => {
		const random = makeRandom(0x5eed_1234);
		for (let case_index = 0; case_index < 250; case_index++) {
			const old_text = randomText(random, 40);
			// Half the cases are related texts, half are independent.
			const new_text = case_index % 2 === 0 ? mutate(random, old_text) : randomText(random, 40);
			const ops = diffWords(old_text, new_text);
			try {
				expectWellFormed(ops, old_text, new_text);
			} catch (error) {
				throw new Error(
					`case ${case_index} failed\nold: ${JSON.stringify(old_text)}\nnew: ${JSON.stringify(new_text)}`,
					{ cause: error },
				);
			}
		}
	});

	/** Reference LCS length via a naive DP table — only ever run on tiny inputs. */
	function lcsLength(a: string[], b: string[]): number {
		const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
		for (let i = 1; i <= a.length; i++) {
			for (let j = 1; j <= b.length; j++) {
				table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
			}
		}
		return table[a.length][b.length];
	}

	it('produces a minimal edit script (matches a naive LCS reference)', () => {
		const random = makeRandom(0xbeef_0001);
		for (let case_index = 0; case_index < 200; case_index++) {
			const old_text = randomText(random, 14);
			const new_text = case_index % 2 === 0 ? mutate(random, old_text) : randomText(random, 14);
			const old_tokens = tokenizeWords(old_text);
			const new_tokens = tokenizeWords(new_text);
			const ops = diffWords(old_text, new_text);
			expectWellFormed(ops, old_text, new_text);

			const equal_tokens = ops
				.filter((op) => op.type === 'equal')
				.reduce((total, op) => total + tokenizeWords(op.text).length, 0);
			expect(equal_tokens).toBe(lcsLength(old_tokens, new_tokens));
		}
	});

	it('round-trips under an artificially tiny edit-distance guard', () => {
		const random = makeRandom(0xc0ffee);
		for (let case_index = 0; case_index < 100; case_index++) {
			const old_text = randomText(random, 60);
			const new_text = mutate(random, old_text);
			const ops = diffWords(old_text, new_text, { max_edit_distance: 2 });
			expectWellFormed(ops, old_text, new_text);
		}
	});
});

describe('tokenizeLines', () => {
	it('is lossless', () => {
		const samples = [
			'',
			'one line, no terminator',
			'a\nb\nc\n',
			'a\r\nb\r\nc',
			'a\rb\rc\r',
			'mixed\nendings\r\nin\rone\nfile',
			'\n\n\n',
			'trailing fragment\nafter a newline',
		];
		for (const sample of samples) expect(tokenizeLines(sample).join('')).toBe(sample);
	});

	it('keeps each terminator attached to its own line', () => {
		expect(tokenizeLines('a\nb\n')).toEqual(['a\n', 'b\n']);
		expect(tokenizeLines('a\r\nb')).toEqual(['a\r\n', 'b']);
		expect(tokenizeLines('a\rb\r')).toEqual(['a\r', 'b\r']);
		expect(tokenizeLines('\n')).toEqual(['\n']);
	});

	it('does not split a CRLF pair', () => {
		expect(tokenizeLines('x\r\ny')).toHaveLength(2);
	});
});

describe('diffLines', () => {
	it('handles degenerate inputs', () => {
		expect(diffLines('', '')).toEqual([]);
		expect(diffLines('', 'a\n')).toEqual([{ type: 'insert', text: 'a\n' }]);
		expect(diffLines('a\n', '')).toEqual([{ type: 'delete', text: 'a\n' }]);
		expect(diffLines('a\n', 'a\n')).toEqual([{ type: 'equal', text: 'a\n' }]);
	});

	it('changes only the line that changed', () => {
		const old_text = 'alpha\nbeta\ngamma\n';
		const new_text = 'alpha\nBETA\ngamma\n';
		const ops = diffLines(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops).toEqual([
			{ type: 'equal', text: 'alpha\n' },
			{ type: 'delete', text: 'beta\n' },
			{ type: 'insert', text: 'BETA\n' },
			{ type: 'equal', text: 'gamma\n' },
		]);
	});

	it('reports an inserted line without touching its neighbours', () => {
		const old_text = 'one\ntwo\n';
		const new_text = 'one\nmiddle\ntwo\n';
		const ops = diffLines(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops.filter((op) => op.type === 'delete')).toHaveLength(0);
		expect(ops.filter((op) => op.type === 'insert').map((op) => op.text)).toEqual(['middle\n']);
	});

	it('round-trips text with mixed line endings', () => {
		const old_text = 'a\r\nb\nc\rd';
		const new_text = 'a\r\nB\nc\rd';
		const ops = diffLines(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
	});

	it('treats a line-ending conversion as a change on every line', () => {
		// The terminator is part of the token, so LF -> CRLF really does change every line.
		// That is the honest answer for a line diff; diffWords is the tool that ignores it.
		const old_text = 'a\nb\nc\n';
		const new_text = 'a\r\nb\r\nc\r\n';
		const ops = diffLines(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops.filter((op) => op.type === 'equal')).toHaveLength(0);
	});

	it('handles a missing trailing newline as a change to the last line only', () => {
		const old_text = 'a\nb\n';
		const new_text = 'a\nb';
		const ops = diffLines(old_text, new_text);
		expectWellFormed(ops, old_text, new_text);
		expect(ops[0]).toEqual({ type: 'equal', text: 'a\n' });
	});

	it('round-trips 200 randomized line pairs', () => {
		const random = makeRandom(0x11e5_eed1);
		const LINES = ['alpha', 'beta', 'gamma', 'delta', '', '  indented', 'x'];
		const ENDINGS = ['\n', '\r\n', '\r'];
		const makeText = (): string => {
			const count = Math.floor(random() * 30);
			let text = '';
			for (let i = 0; i < count; i++) {
				text += LINES[Math.floor(random() * LINES.length)];
				if (i < count - 1 || random() < 0.8) {
					text += ENDINGS[Math.floor(random() * ENDINGS.length)];
				}
			}
			return text;
		};
		for (let case_index = 0; case_index < 200; case_index++) {
			const old_text = makeText();
			const new_text = case_index % 2 === 0 ? makeText() : old_text;
			const ops = diffLines(old_text, new_text);
			try {
				expectWellFormed(ops, old_text, new_text);
			} catch (error) {
				throw new Error(`line case ${case_index} failed`, { cause: error });
			}
		}
	});
});
