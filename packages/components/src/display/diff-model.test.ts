import { describe, expect, it } from 'vitest';
import {
	buildDiffModel,
	hunksFromText,
	mergeRowOps,
	nextChange,
	previousChange,
	sectionize,
	tokenizeGraphemes,
	type DiffHunk,
	type DiffRow,
} from './diff-model.js';

/** The text a row shows on each side, deletions and insertions included. */
function textOf(ops: DiffRow['before_ops']): string {
	return ops.map((op) => op.text).join('');
}

function shape(rows: DiffRow[]): string[] {
	return rows.map(
		(row) =>
			`${row.kind}|${row.before_line ?? '-'}|${row.after_line ?? '-'}|${textOf(row.after_ops) || textOf(row.before_ops)}`,
	);
}

describe('hunksFromText', () => {
	it('returns nothing for two empty strings', () => {
		expect(hunksFromText('', '')).toEqual([]);
	});

	it('returns one equal hunk for identical text', () => {
		expect(hunksFromText('same', 'same')).toEqual([
			{ kind: 'equal', before: 'same', after: 'same' },
		]);
	});

	it('returns an insert when the old text is empty', () => {
		expect(hunksFromText('', 'new')).toEqual([{ kind: 'insert', after: 'new' }]);
	});

	it('returns a delete when the new text is empty', () => {
		expect(hunksFromText('old', '')).toEqual([{ kind: 'delete', before: 'old' }]);
	});

	it('returns a replace otherwise', () => {
		expect(hunksFromText('old', 'new')).toEqual([
			{ kind: 'replace', before: 'old', after: 'new' },
		]);
	});
});

describe('tokenizeGraphemes', () => {
	it('is lossless', () => {
		const text = 'a👩‍👩‍👧‍👦b🇬🇧c é 世界';
		expect(tokenizeGraphemes(text).join('')).toBe(text);
	});

	it('keeps a ZWJ family emoji whole', () => {
		expect(tokenizeGraphemes('👩‍👩‍👧‍👦')).toEqual(['👩‍👩‍👧‍👦']);
	});

	it('keeps a flag whole', () => {
		expect(tokenizeGraphemes('🇬🇧')).toEqual(['🇬🇧']);
	});
});

describe('buildDiffModel — word granularity', () => {
	it('marks only the word that changed', () => {
		const model = buildDiffModel(
			hunksFromText('the quick brown fox', 'the quick red fox'),
		);
		expect(model.rows).toHaveLength(1);
		const row = model.rows[0];
		expect(row.kind).toBe('replace');
		expect(row.before_ops.map((op) => op.type)).toEqual(['equal', 'delete', 'equal']);
		expect(row.after_ops.map((op) => op.type)).toEqual(['equal', 'insert', 'equal']);
		expect(row.before_ops[1].text).toBe('brown');
		expect(row.after_ops[1].text).toBe('red');
	});

	it('survives a rewrap — one word changes, not every line', () => {
		const before = 'alpha beta gamma\ndelta epsilon zeta';
		const after = 'alpha beta GAMMA\ndelta epsilon zeta';
		const model = buildDiffModel(hunksFromText(before, after));
		expect(model.stats).toMatchObject({ changed: 1, unchanged: 1, added: 0, removed: 0 });
	});

	it('diffs CJK per character', () => {
		const model = buildDiffModel(hunksFromText('世界平和', '世界調和'));
		const inserted = model.rows[0].after_ops.filter((op) => op.type === 'insert');
		expect(inserted.map((op) => op.text)).toEqual(['調']);
	});

	it('treats punctuation as its own token', () => {
		const model = buildDiffModel(hunksFromText('hello, world', 'hello; world'));
		const changed = model.rows[0].after_ops.filter((op) => op.type === 'insert');
		expect(changed.map((op) => op.text)).toEqual([';']);
	});

	it('does not split a ZWJ emoji', () => {
		const model = buildDiffModel(hunksFromText('a 👩‍👩‍👧‍👦 b', 'a 👨‍👨‍👦 b'));
		const removed = model.rows[0].before_ops.filter((op) => op.type === 'delete');
		expect(removed.map((op) => op.text)).toEqual(['👩‍👩‍👧‍👦']);
	});
});

describe('buildDiffModel — granularity', () => {
	it('char granularity finds the letter', () => {
		const model = buildDiffModel(hunksFromText('colour', 'color'), {
			granularity: 'char',
		});
		const removed = model.rows[0].before_ops.filter((op) => op.type === 'delete');
		expect(removed.map((op) => op.text)).toEqual(['u']);
	});

	it('word granularity replaces the whole word instead', () => {
		const model = buildDiffModel(hunksFromText('colour', 'color'));
		const removed = model.rows[0].before_ops.filter((op) => op.type === 'delete');
		expect(removed.map((op) => op.text)).toEqual(['colour']);
	});

	it('line granularity replaces the whole line, marking nothing inside it', () => {
		const model = buildDiffModel(hunksFromText('one two\nthree', 'one TWO\nthree'), {
			granularity: 'line',
		});
		expect(model.rows.map((row) => row.kind)).toEqual(['replace', 'equal']);
		expect(model.rows[0].before_ops).toEqual([{ type: 'delete', text: 'one two' }]);
		expect(model.rows[0].after_ops).toEqual([{ type: 'insert', text: 'one TWO' }]);
	});
});

describe('buildDiffModel — line alignment', () => {
	it('numbers both sides through an insertion', () => {
		const model = buildDiffModel(hunksFromText('a\nb', 'a\nX\nb'), {
			context_lines: Infinity,
		});
		expect(shape(model.rows)).toEqual(['equal|1|1|a', 'insert|-|2|X', 'equal|2|3|b']);
	});

	it('numbers both sides through a deletion', () => {
		const model = buildDiffModel(hunksFromText('a\nb\nc', 'a\nc'));
		expect(shape(model.rows)).toEqual(['equal|1|1|a', 'delete|2|-|b', 'equal|3|2|c']);
	});

	it('pairs a wholly rewritten line into one row', () => {
		const model = buildDiffModel(hunksFromText('a\nbbb\nc', 'a\nddd\nc'));
		expect(model.rows.map((row) => row.kind)).toEqual(['equal', 'replace', 'equal']);
		expect(textOf(model.rows[1].before_ops)).toBe('bbb');
		expect(textOf(model.rows[1].after_ops)).toBe('ddd');
	});

	it('does not emit a row for a trailing newline', () => {
		const model = buildDiffModel(hunksFromText('a\n', 'a\nb\n'));
		expect(shape(model.rows)).toEqual(['equal|1|1|a', 'insert|-|2|b']);
	});

	it('keeps an insert-only hunk off the old side', () => {
		const model = buildDiffModel([{ kind: 'insert', after: 'one\ntwo' }]);
		expect(model.rows.every((row) => row.before_line === null)).toBe(true);
		expect(model.rows.map((row) => row.after_line)).toEqual([1, 2]);
	});

	it('keeps a delete-only hunk off the new side', () => {
		const model = buildDiffModel([{ kind: 'delete', before: 'one\ntwo' }]);
		expect(model.rows.every((row) => row.after_line === null)).toBe(true);
		expect(model.rows.map((row) => row.before_line)).toEqual([1, 2]);
	});

	it('runs line numbers across hunks', () => {
		const hunks: DiffHunk[] = [
			{ kind: 'equal', before: 'a', after: 'a' },
			{ kind: 'delete', before: 'b' },
			{ kind: 'insert', after: 'c' },
			{ kind: 'equal', before: 'd', after: 'd' },
		];
		const model = buildDiffModel(hunks, { context_lines: Infinity });
		expect(model.rows.map((row) => row.before_line)).toEqual([1, 2, null, 3]);
		expect(model.rows.map((row) => row.after_line)).toEqual([1, null, 2, 3]);
	});
});

describe('buildDiffModel — anchored alignment at the end of the text', () => {
	// Every group but the last ends at a newline both texts share. The last one
	// ends at the end of the text, which is not evidence of anything — so an
	// appended line used to drag the untouched line above it out of place.

	it('appending a list item leaves the first item alone', () => {
		const model = buildDiffModel(hunksFromText('- a', '- a\n- b'), {
			context_lines: Infinity,
		});
		expect(shape(model.rows)).toEqual(['equal|1|1|- a', 'insert|-|2|- b']);
	});

	it('appending a line to a one-line document leaves that line alone', () => {
		const model = buildDiffModel(hunksFromText('a', 'a\nb'), { context_lines: Infinity });
		expect(shape(model.rows)).toEqual(['equal|1|1|a', 'insert|-|2|b']);
	});

	it('removing the last line leaves the one above it alone', () => {
		const model = buildDiffModel(hunksFromText('a\nb', 'a'), { context_lines: Infinity });
		expect(shape(model.rows)).toEqual(['equal|1|1|a', 'delete|2|-|b']);
	});

	it('appending two lines leaves the first alone', () => {
		const model = buildDiffModel(hunksFromText('x y', 'x y\nz\nw'), {
			context_lines: Infinity,
		});
		expect(shape(model.rows)).toEqual([
			'equal|1|1|x y',
			'insert|-|2|z',
			'insert|-|3|w',
		]);
	});

	it('still removes the right line when the last one is anchored', () => {
		const model = buildDiffModel(hunksFromText('x\nA\nB', 'x\nB'), {
			context_lines: Infinity,
		});
		expect(shape(model.rows)).toEqual(['equal|1|1|x', 'delete|2|-|A', 'equal|3|2|B']);
	});

	it('keeps a blank line the writer put inside the text', () => {
		const model = buildDiffModel(hunksFromText('a\n\nb', 'a\n\nc'), {
			context_lines: Infinity,
		});
		expect(model.rows.map((row) => row.before_line)).toEqual([1, 2, 3]);
		expect(model.rows.map((row) => row.after_line)).toEqual([1, 2, 3]);
	});
});

describe('buildDiffModel — side-by-side alignment', () => {
	it('pads the shorter side so both columns advance one row at a time', () => {
		const model = buildDiffModel(hunksFromText('a\nb\nc', 'a\nX\nY\nc'), {
			context_lines: Infinity,
		});
		// Three old lines against four new ones. `a` and `c` are anchored — the
		// two sides share their text — so the gap between them holds one old line
		// and two new ones: the first pair up, and the new line with nothing
		// opposite it gets a row of its own, which is what keeps the two columns
		// level.
		expect(shape(model.rows)).toEqual([
			'equal|1|1|a',
			'replace|2|2|X',
			'insert|-|3|Y',
			'equal|3|4|c',
		]);
		expect(model.rows.filter((row) => row.before_line === null)).toHaveLength(1);
	});

	it('never puts an insertion op on the old side or a deletion on the new', () => {
		const model = buildDiffModel(hunksFromText('one two three', 'one four three'));
		for (const row of model.rows) {
			expect(row.before_ops.every((op) => op.type !== 'insert')).toBe(true);
			expect(row.after_ops.every((op) => op.type !== 'delete')).toBe(true);
		}
	});
});

describe('buildDiffModel — moved', () => {
	it('flags every row of a moved hunk and carries the indices', () => {
		const model = buildDiffModel([
			{ kind: 'equal', before: 'a', after: 'a' },
			{
				kind: 'moved',
				before: 'b',
				after: 'b',
				key: 'blk',
				before_index: 0,
				after_index: 2,
			},
		]);
		const moved = model.rows[1];
		expect(moved.moved).toBe(true);
		expect(moved.key).toBe('blk');
		expect(moved.moved_from).toBe(0);
		expect(moved.moved_to).toBe(2);
		expect(model.stats.moved).toBe(1);
	});

	it('counts a moved-and-edited hunk as changed too', () => {
		const model = buildDiffModel([
			{
				kind: 'moved',
				before: 'the cat',
				after: 'the dog',
				before_index: 2,
				after_index: 0,
			},
		]);
		expect(model.rows[0].kind).toBe('replace');
		expect(model.rows[0].moved).toBe(true);
		expect(model.stats).toMatchObject({ moved: 1, changed: 1 });
	});

	it('counts a moved row as a change for navigation', () => {
		const model = buildDiffModel([
			{ kind: 'equal', before: 'a', after: 'a' },
			{ kind: 'moved', before: 'b', after: 'b' },
		]);
		expect(model.changes).toEqual([1]);
		expect(model.changed).toBe(true);
	});
});

describe('buildDiffModel — a move drawn at both ends', () => {
	/** A move out of the middle: `b` was line 2 and is now line 3. */
	const hunks: DiffHunk[] = [
		{ kind: 'equal', before: 'a', after: 'a' },
		{
			kind: 'moved',
			key: 'blk',
			before: 'b',
			before_index: 1,
			after_index: 2,
			stub: true,
		},
		{ kind: 'equal', before: 'c', after: 'c' },
		{
			kind: 'moved',
			key: 'blk',
			before: 'b',
			after: 'b',
			before_index: 1,
			after_index: 2,
		},
	];

	it('draws the stub as one row with nothing in it', () => {
		const model = buildDiffModel(hunks);
		const stub = model.rows[1];
		expect(stub.moved_stub).toBe(true);
		expect(stub.moved).toBe(true);
		expect(stub.before_ops).toEqual([]);
		expect(stub.after_ops).toEqual([]);
		expect(stub.after_line).toBe(null);
	});

	it('gives the old line numbers to the stub and none to the span', () => {
		const model = buildDiffModel(hunks);
		// The stub stands where the old document had the block, so it holds the
		// old line — and the span, drawn at its new position, holds only the new.
		expect(model.rows.map((row) => row.before_line)).toEqual([1, 2, 3, null]);
		expect(model.rows.map((row) => row.after_line)).toEqual([1, null, 2, 3]);
	});

	it('lets the two ends name each other, whichever way the move went', () => {
		const model = buildDiffModel(hunks);
		const [, stub, , span] = model.rows;
		expect(stub.moved_to_line).toBe(3);
		expect(span.moved_from_line).toBe(2);
		expect(span.moved_head).toBe(true);
	});

	it('counts the move once, not once per end', () => {
		expect(buildDiffModel(hunks).stats.moved).toBe(1);
	});

	it('makes the stub a change, so it neither collapses nor is skipped', () => {
		const model = buildDiffModel(hunks, { context_lines: 0 });
		expect(model.changes).toContain(1);
		expect(model.sections.every((section) => section.kind === 'rows')).toBe(true);
	});

	it('numbers a moved-and-changed span against its stub, and diffs it in place', () => {
		const model = buildDiffModel([
			{
				kind: 'moved',
				before: 'the cat sat',
				before_index: 2,
				after_index: 0,
				changed: true,
				stub: true,
			},
			{
				kind: 'moved',
				before: 'the cat sat',
				after: 'the dog sat',
				before_index: 2,
				after_index: 0,
				changed: true,
			},
		]);
		const [stub, span] = model.rows;
		expect(span.kind).toBe('replace');
		expect(span.moved_changed).toBe(true);
		expect(span.after_ops.some((op) => op.type === 'insert')).toBe(true);
		expect(stub.moved_to_line).toBe(1);
		expect(span.moved_from_line).toBe(1);
		expect(model.stats).toMatchObject({ moved: 1, changed: 1 });
	});

	it('counts every line the span held, so the numbers below a move stay true', () => {
		const model = buildDiffModel([
			{ kind: 'moved', before: 'one\ntwo\nthree', before_index: 0, after_index: 1, stub: true },
			{ kind: 'equal', before: 'tail', after: 'tail' },
			{ kind: 'moved', before: 'one\ntwo\nthree', after: 'one\ntwo\nthree', before_index: 0, after_index: 1 },
		]);
		// The stub is one row but stands for three, so `tail` is still line 4.
		expect(model.rows[1].before_line).toBe(4);
	});

	it('still numbers both sides of a moved hunk that came without a stub', () => {
		const model = buildDiffModel([
			{ kind: 'moved', before: 'b', after: 'b', before_index: 0, after_index: 1 },
		]);
		expect(model.rows[0].before_line).toBe(1);
		expect(model.rows[0].moved_from_line).toBe(null);
		expect(model.rows[0].moved_stub).toBe(false);
	});
});

describe('buildDiffModel — each end of a move is its own stop', () => {
	/** B swapped with A: the span and its stub end up touching. */
	const swap: DiffHunk[] = [
		{ kind: 'moved', before: 'B', after: 'B', before_index: 1, after_index: 0 },
		{ kind: 'moved', before: 'B', before_index: 1, after_index: 0, stub: true },
	];

	it('gives an adjacent span and stub two entries in `changes`', () => {
		// One run of change by the ordinary rule, and stepping it as one run
		// would land on the span and then skip the stub it points at.
		const model = buildDiffModel(swap);
		expect(model.changes).toEqual([0, 1]);
	});

	it('makes both ends focusable', () => {
		const model = buildDiffModel(swap);
		expect(model.changes_set.has(0)).toBe(true);
		expect(model.changes_set.has(1)).toBe(true);
	});

	it('still folds an ordinary run of changed rows into one stop', () => {
		const model = buildDiffModel([
			{ kind: 'equal', before: 'a', after: 'a' },
			{ kind: 'replace', before: 'one\ntwo\nthree', after: 'ONE\nTWO\nTHREE' },
		]);
		expect(model.changes).toEqual([1]);
	});

	it('starts a new stop at a move that follows an unrelated change', () => {
		const model = buildDiffModel([
			{ kind: 'insert', after: 'new' },
			{ kind: 'moved', before: 'b', after: 'b', before_index: 0, after_index: 1 },
			{ kind: 'moved', before: 'b', before_index: 0, after_index: 1, stub: true },
		]);
		expect(model.changes).toEqual([0, 1, 2]);
	});
});

describe('buildDiffModel — a stub without indices', () => {
	it('throws rather than folding every such stub onto one key', () => {
		// Two stubs with no indices share a `moveID`, so they would pair with
		// each other's span and every marker would point at the wrong row.
		expect(() =>
			buildDiffModel([{ kind: 'moved', before: 'b', stub: true }]),
		).toThrow(/before_index/);
	});

	it('names itself as a diff error, with a code a caller can narrow on', () => {
		try {
			buildDiffModel([{ kind: 'moved', before: 'b', after_index: 2, stub: true }]);
			expect.unreachable('a stub without both indices must throw');
		} catch (error) {
			expect((error as { name: string }).name).toBe('DiffError');
			expect((error as { code: string }).code).toBe('stub_without_indices');
		}
	});

	it('leaves a stubless moved hunk with no indices alone — the pre-stub shape', () => {
		const model = buildDiffModel([{ kind: 'moved', before: 'b', after: 'b' }]);
		expect(model.rows[0].moved).toBe(true);
		expect(model.rows[0].moved_from_line).toBe(null);
	});
});

describe('sectionize', () => {
	const rowsOf = (kinds: DiffRow['kind'][]): DiffRow[] =>
		kinds.map((kind, i) => ({
			kind,
			before_line: i + 1,
			after_line: i + 1,
			before_ops: [],
			after_ops: [],
			hunk: 0,
			key: null,
			moved: false,
			moved_from: null,
			moved_to: null,
			moved_stub: false,
			moved_head: false,
			moved_changed: false,
			moved_from_line: null,
			moved_to_line: null,
		}));

	it('collapses a long unchanged run down to the context on each side', () => {
		const rows = rowsOf([
			'replace',
			...(Array(12).fill('equal') as DiffRow['kind'][]),
			'replace',
		]);
		const sections = sectionize(rows, 3);
		expect(sections.map((section) => section.kind)).toEqual([
			'rows',
			'collapsed',
			'rows',
		]);
		expect(sections[0].rows).toHaveLength(4);
		expect(sections[1]).toMatchObject({ kind: 'collapsed', count: 6 });
		expect(sections[2].rows).toHaveLength(4);
	});

	it('drops the leading unchanged run to its tail context', () => {
		const rows = rowsOf([...(Array(9).fill('equal') as DiffRow['kind'][]), 'insert']);
		const sections = sectionize(rows, 2);
		expect(sections[0]).toMatchObject({ kind: 'collapsed', count: 7 });
		expect(sections[1].rows).toHaveLength(3);
	});

	it('drops the trailing unchanged run to its head context', () => {
		const rows = rowsOf(['insert', ...(Array(9).fill('equal') as DiffRow['kind'][])]);
		const sections = sectionize(rows, 2);
		expect(sections[0].rows).toHaveLength(3);
		expect(sections[1]).toMatchObject({ kind: 'collapsed', count: 7 });
	});

	it('leaves a run that would collapse to one row alone', () => {
		const rows = rowsOf([
			'replace',
			'equal',
			'equal',
			'equal',
			'equal',
			'equal',
			'equal',
			'replace',
		]);
		expect(sectionize(rows, 3).map((section) => section.kind)).toEqual(['rows']);
	});

	it('collapses nothing when context is Infinity', () => {
		const rows = rowsOf([
			'replace',
			...(Array(40).fill('equal') as DiffRow['kind'][]),
			'replace',
		]);
		expect(sectionize(rows, Infinity)).toEqual([{ kind: 'rows', rows }]);
	});

	it('shows an unchanged document rather than hiding all of it', () => {
		const rows = rowsOf(Array(40).fill('equal') as DiffRow['kind'][]);
		expect(sectionize(rows, 3).map((section) => section.kind)).toEqual(['rows']);
	});

	it('keeps every row reachable across the sections', () => {
		const rows = rowsOf([
			'insert',
			...(Array(20).fill('equal') as DiffRow['kind'][]),
			'delete',
			...(Array(20).fill('equal') as DiffRow['kind'][]),
			'replace',
		]);
		const seen = sectionize(rows, 3).flatMap((section) => section.rows);
		expect(seen).toEqual(rows);
	});
});

describe('mergeRowOps', () => {
	it('puts a single-line pair back in its original order', () => {
		const model = buildDiffModel(
			hunksFromText('the quick brown fox', 'the quick red fox'),
		);
		expect(mergeRowOps(model.rows[0])).toEqual([
			{ type: 'equal', text: 'the quick ' },
			{ type: 'delete', text: 'brown' },
			{ type: 'insert', text: 'red' },
			{ type: 'equal', text: ' fox' },
		]);
	});

	it('emits the deletion before the insertion at every divergence', () => {
		const model = buildDiffModel(hunksFromText('a b c d e', 'a X c Y e'));
		const types = mergeRowOps(model.rows[0]).map((op) => op.type);
		expect(types.indexOf('delete')).toBeLessThan(types.indexOf('insert'));
		expect(types.filter((type) => type === 'delete')).toHaveLength(2);
		expect(types.filter((type) => type === 'insert')).toHaveLength(2);
	});

	it('reassembles both texts from one row', () => {
		const model = buildDiffModel(hunksFromText('hello brave world', 'hello cruel world'));
		const merged = mergeRowOps(model.rows[0]);
		const old_text = merged
			.filter((op) => op.type !== 'insert')
			.map((op) => op.text)
			.join('');
		const new_text = merged
			.filter((op) => op.type !== 'delete')
			.map((op) => op.text)
			.join('');
		expect(old_text).toBe('hello brave world');
		expect(new_text).toBe('hello cruel world');
	});

	it('handles a row with only one side', () => {
		const model = buildDiffModel([{ kind: 'insert', after: 'new line' }]);
		expect(mergeRowOps(model.rows[0])).toEqual([{ type: 'insert', text: 'new line' }]);
	});
});

describe('navigation', () => {
	const model = buildDiffModel(
		[
			{ kind: 'equal', before: 'a', after: 'a' },
			{ kind: 'insert', after: 'b' },
			{ kind: 'equal', before: 'c', after: 'c' },
			{ kind: 'delete', before: 'd' },
		],
		{ context_lines: Infinity },
	);

	it('steps forward and wraps', () => {
		expect(model.changes).toEqual([1, 3]);
		expect(nextChange(model, -1)).toBe(1);
		expect(nextChange(model, 1)).toBe(3);
		expect(nextChange(model, 3)).toBe(1);
	});

	it('steps backward and wraps', () => {
		expect(previousChange(model, 4)).toBe(3);
		expect(previousChange(model, 3)).toBe(1);
		expect(previousChange(model, 0)).toBe(3);
	});

	it('reports no change on an unchanged model', () => {
		const same = buildDiffModel(hunksFromText('a', 'a'));
		expect(same.changed).toBe(false);
		expect(nextChange(same, 0)).toBe(-1);
		expect(previousChange(same, 0)).toBe(-1);
	});
});
