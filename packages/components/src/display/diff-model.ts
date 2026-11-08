/**
 * The pure model behind `DiffViewer`.
 *
 * No runes, no DOM, no component — a caller hands in the two texts (or the
 * hunks it computed itself) and gets back rows, sections and counts. That split
 * is the point: an app that pairs blocks by a stable id before it diffs their
 * text does the pairing itself and hands the result over, and the viewer
 * renders it without knowing what a block is.
 *
 * Everything here is built on `@delightstack/diff`: `diffWords` for prose,
 * `diffLines` for the line granularity, and `diffTokens` over grapheme clusters
 * for the character granularity, which is the one shape the diff package does
 * not ship a tokenizer for.
 */

import {
	DiffError,
	diffLines,
	diffTokens,
	diffWords,
	type DiffOp,
} from '@delightstack/diff';

/* -------------------------------------------------------------------- */
/*  Input                                                                */
/* -------------------------------------------------------------------- */

/** What a hunk claims happened to one span of the document. */
export type DiffHunkKind = 'equal' | 'insert' | 'delete' | 'replace' | 'moved';

/** How the text inside a `replace` or `moved` hunk is compared. */
export type DiffGranularity = 'word' | 'char' | 'line';

/**
 * One aligned span of the two documents.
 *
 * A caller with no structure to offer passes a single `replace` hunk holding
 * both whole texts — `hunksFromText` builds exactly that. A caller that knows
 * which parts of the two documents correspond (blocks paired by id, rows paired
 * by primary key) passes one hunk per pair, and the alignment it worked out is
 * the alignment that gets rendered.
 */
export interface DiffHunk {
	kind: DiffHunkKind;
	/** The old text. Required for every kind but `insert`. */
	before?: string;
	/** The new text. Required for every kind but `delete`. */
	after?: string;
	/** The caller's identity for this span, echoed onto every row it produces. */
	key?: string;
	/** Where the span sat in the old sequence. Only meaningful for `moved`. */
	before_index?: number;
	/** Where the span sits in the new sequence. Only meaningful for `moved`. */
	after_index?: number;
	/**
	 * A moved span whose text also changed, so the two sides are worth
	 * comparing. Only meaningful for `moved`; ignored elsewhere.
	 */
	changed?: boolean;
	/**
	 * This hunk is the **placeholder at the span's old position**, not the span.
	 *
	 * A move has two ends and the reader needs both: where the text went, and
	 * the hole it left. A caller that wants the move drawn as a move passes two
	 * `moved` hunks with the same `before_index` / `after_index` — the stub,
	 * placed where the old document had the span, and the span itself, placed
	 * where the new document has it. The stub renders as one line saying where
	 * the text went; it carries `before` only so the old side's line numbers can
	 * be counted off it, and nothing of it is drawn.
	 *
	 * Passing a `moved` hunk with no stub is still valid and is what the
	 * component did before: the span renders once, in its new position, marked.
	 */
	stub?: boolean;
}

export interface BuildDiffModelOptions {
	/** Default `'word'`. Prose reflows, so words are almost always the answer. */
	granularity?: DiffGranularity;
	/**
	 * Unchanged rows kept either side of a change. Default `3`.
	 *
	 * `Infinity` — or any negative number — keeps everything and collapses
	 * nothing.
	 */
	context_lines?: number;
}

/* -------------------------------------------------------------------- */
/*  Output                                                               */
/* -------------------------------------------------------------------- */

/**
 * One line of the rendered diff, carrying both sides.
 *
 * The same row serves both modes: inline draws `after_ops` with the deletions
 * from `before_ops` woven in, side-by-side draws the two op lists in two cells.
 * A row with no old side has `before_line: null` and an empty `before_ops`, and
 * likewise for the new side — which is what makes the two columns line up
 * without a second alignment pass.
 */
export interface DiffRow {
	kind: 'equal' | 'insert' | 'delete' | 'replace';
	/** 1-based line number in the old document, or `null` if absent from it. */
	before_line: number | null;
	/** 1-based line number in the new document, or `null` if absent from it. */
	after_line: number | null;
	/** `equal` and `delete` ops — everything the old side showed. */
	before_ops: DiffOp[];
	/** `equal` and `insert` ops — everything the new side shows. */
	after_ops: DiffOp[];
	/** Index of the hunk this row came from. */
	hunk: number;
	/** The hunk's `key`, or `null`. */
	key: string | null;
	/** The row belongs to a hunk the caller marked `moved`. `data-moved` in the DOM. */
	moved: boolean;
	/** The hunk's `before_index` — where the span sat in the old sequence. */
	moved_from: number | null;
	/** The hunk's `after_index` — where the span sits in the new sequence. */
	moved_to: number | null;
	/**
	 * The row *is* the placeholder at the old position, not the span.
	 *
	 * One row per stub hunk, whatever the span's height: a stub is a marker, and
	 * a marker that reproduced the moved text at both ends would be the
	 * delete-plus-insert the move exists to avoid. It carries no ops, so a
	 * renderer draws its own line here.
	 */
	moved_stub: boolean;
	/** The first row of a moved hunk — where a "moved from …" marker belongs. */
	moved_head: boolean;
	/** The span moved *and* its text changed, so both sides are worth reading. */
	moved_changed: boolean;
	/**
	 * The old document's line number for the head of the move, on both ends.
	 *
	 * Resolved after the rows are built, by matching each stub to the span with
	 * the same `moved_from` / `moved_to`, so the two ends can name each other
	 * whichever way round they landed. `null` when a `moved` hunk came without a
	 * stub, which is the pre-move-rendering shape.
	 */
	moved_from_line: number | null;
	/** The new document's line number for the head of the move, on both ends. */
	moved_to_line: number | null;
}

/**
 * A run of rows, either shown or collapsed behind an expander.
 *
 * `collapsed` sections still carry their rows — collapsing is a presentation
 * decision, and a caller that expands one must not have to rebuild the model.
 */
export type DiffSection =
	| { kind: 'rows'; rows: DiffRow[] }
	| { kind: 'collapsed'; rows: DiffRow[]; count: number };

export interface DiffStats {
	added: number;
	removed: number;
	changed: number;
	moved: number;
	unchanged: number;
}

export interface DiffModel {
	rows: DiffRow[];
	sections: DiffSection[];
	stats: DiffStats;
	/**
	 * Index into `rows` of the first row of each run of change — what `n` and
	 * `p` step through, in order.
	 */
	changes: number[];
	/**
	 * The same indices as a set.
	 *
	 * Both, because the two questions are different: stepping needs the order,
	 * and rendering asks "is this row the head of a change?" once per row. Over
	 * `changes` that second question is a linear scan inside a loop over the same
	 * rows, which is quadratic on exactly the long diff the collapsing exists for.
	 */
	changes_set: Set<number>;
	/** `false` when every row is an unmoved `equal`. */
	changed: boolean;
}

/* -------------------------------------------------------------------- */
/*  Character tokenization                                               */
/* -------------------------------------------------------------------- */

let grapheme_segmenter: Intl.Segmenter | undefined;

/**
 * Split text into user-perceived characters.
 *
 * `Array.from` splits by code point, which cuts a ZWJ family emoji into six
 * pieces and a flag into two — a character diff that can report half an emoji
 * changed is worse than no character diff. `Intl.Segmenter` is Baseline; the
 * code-point path is the fallback for a runtime without it, and is lossless
 * either way.
 */
export function tokenizeGraphemes(text: string): string[] {
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		grapheme_segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
		const out: string[] = [];
		for (const piece of grapheme_segmenter.segment(text)) out.push(piece.segment);
		return out;
	}
	return Array.from(text);
}

function diffAt(before: string, after: string, granularity: DiffGranularity): DiffOp[] {
	if (granularity === 'line') return diffLines(before, after);
	if (granularity === 'char') {
		return diffTokens(tokenizeGraphemes(before), tokenizeGraphemes(after));
	}
	return diffWords(before, after);
}

/* -------------------------------------------------------------------- */
/*  Hunks from two plain strings                                         */
/* -------------------------------------------------------------------- */

/**
 * The whole-document case: one hunk holding both texts.
 *
 * There is nothing cleverer to do without knowing the documents' structure —
 * the alignment inside the hunk is the diff's job, and it is done in
 * `buildDiffModel` at the requested granularity.
 */
export function hunksFromText(before: string, after: string): DiffHunk[] {
	if (before === after) return before === '' ? [] : [{ kind: 'equal', before, after }];
	if (before === '') return [{ kind: 'insert', after }];
	if (after === '') return [{ kind: 'delete', before }];
	return [{ kind: 'replace', before, after }];
}

/* -------------------------------------------------------------------- */
/*  Rows                                                                 */
/* -------------------------------------------------------------------- */

/** Split text into lines, dropping the empty tail a trailing newline leaves. */
function splitLines(text: string): string[] {
	const lines = text.split('\n');
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

interface RowSeed {
	before: DiffOp[] | null;
	after: DiffOp[] | null;
}

/**
 * Align one changed pair into rows, anchored on the text the two sides share.
 *
 * Every `equal` op is pushed to both sides at once, so each one lands in
 * exactly one line on each side — and that pairing is the only alignment
 * evidence there is. Recording `(before_line, after_line)` for each of them
 * gives a spine of anchors that is monotonic in both coordinates by
 * construction, and a row that sits on an anchor is a row the two documents
 * agree about.
 *
 * Between two consecutive anchors sit lines with no shared text. Those are
 * paired positionally **from the top of the gap** — a gap is bounded at both
 * ends, so top-pairing inside it is well defined — and whatever is left over on
 * one side becomes rows with nothing opposite them. A wholly rewritten line
 * therefore still reads as one `replace` row rather than a deletion followed by
 * an insertion.
 *
 * > The previous version paired each group **from the bottom**, on the reasoning
 * > that each side's last line runs into the shared newline that ended the
 * > group. That holds for every group but the last one, which ends at the end of
 * > the text and is anchored by nothing: appending a line to `- a` bottom-paired
 * > the old `- a` against the new `- b` and drew the untouched `- a` as an
 * > insertion above it. Anchoring on the equal ops removes the special case
 * > rather than adding one for the tail.
 */
function alignPair(
	before: string,
	after: string,
	granularity: DiffGranularity,
): RowSeed[] {
	const ops = diffAt(before, after, granularity);

	const before_lines: DiffOp[][] = [[]];
	const after_lines: DiffOp[][] = [[]];
	/** `[before_line, after_line]` for each line pair some equal text lands in. */
	const anchors: [number, number][] = [];

	for (const op of ops) {
		const parts = op.text.split('\n');
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (part !== '') {
				const piece: DiffOp = { type: op.type, text: part };
				if (op.type !== 'insert') before_lines[before_lines.length - 1].push(piece);
				if (op.type !== 'delete') after_lines[after_lines.length - 1].push(piece);
				if (op.type === 'equal') {
					const b = before_lines.length - 1;
					const a = after_lines.length - 1;
					const last = anchors[anchors.length - 1];
					if (!last || last[0] !== b || last[1] !== a) anchors.push([b, a]);
				}
			}
			if (i === parts.length - 1) continue;
			// A newline in an equal op ends a line on both sides; one in a deletion
			// or an insertion ends a line only on the side that has it.
			if (op.type !== 'insert') before_lines.push([]);
			if (op.type !== 'delete') after_lines.push([]);
		}
	}

	// Text ending in a newline leaves an empty line behind it that nobody wrote.
	// An anchor never points at one — an anchored line holds equal text — so
	// dropping it cannot invalidate the spine. A blank line *inside* the text is
	// a line the writer put there and stays.
	if (before_lines.length > 1 && before_lines[before_lines.length - 1].length === 0) {
		before_lines.pop();
	}
	if (after_lines.length > 1 && after_lines[after_lines.length - 1].length === 0) {
		after_lines.pop();
	}

	const seeds: RowSeed[] = [];
	let b = 0;
	let a = 0;

	/** Everything between the cursor and the next anchor, paired from the top. */
	const emitGap = (b_end: number, a_end: number) => {
		const paired = Math.min(b_end - b, a_end - a);
		for (let i = 0; i < paired; i++) {
			seeds.push({ before: before_lines[b + i], after: after_lines[a + i] });
		}
		for (let i = b + paired; i < b_end; i++)
			seeds.push({ before: before_lines[i], after: null });
		for (let i = a + paired; i < a_end; i++)
			seeds.push({ before: null, after: after_lines[i] });
		b = b_end;
		a = a_end;
	};

	for (const [bi, ai] of anchors) {
		// Two anchors can share a coordinate — a line split in two puts equal text
		// either side of an inserted newline, so one before-line anchors to two
		// after-lines. The first one wins and the rest fall into the next gap.
		if (bi < b || ai < a) continue;
		emitGap(bi, ai);
		seeds.push({ before: before_lines[bi], after: after_lines[ai] });
		b = bi + 1;
		a = ai + 1;
	}
	emitGap(before_lines.length, after_lines.length);

	return seeds;
}

function seedsForHunk(hunk: DiffHunk, granularity: DiffGranularity): RowSeed[] {
	const before = hunk.before ?? '';
	const after = hunk.after ?? '';
	if (hunk.kind === 'insert') {
		return splitLines(after).map((line) => ({
			before: null,
			after: line === '' ? [] : [{ type: 'insert' as const, text: line }],
		}));
	}
	if (hunk.kind === 'delete') {
		return splitLines(before).map((line) => ({
			before: line === '' ? [] : [{ type: 'delete' as const, text: line }],
			after: null,
		}));
	}
	if (hunk.kind === 'equal' || before === after) {
		return splitLines(before).map((line) => {
			const ops = line === '' ? [] : [{ type: 'equal' as const, text: line }];
			return { before: ops, after: ops };
		});
	}
	return alignPair(before, after, granularity);
}

function kindOf(seed: RowSeed): DiffRow['kind'] {
	const removed = seed.before?.some((op) => op.type === 'delete') ?? false;
	const added = seed.after?.some((op) => op.type === 'insert') ?? false;
	if (removed && added) return 'replace';
	if (removed) return 'delete';
	if (added) return 'insert';
	if (seed.before === null) return 'insert';
	if (seed.after === null) return 'delete';
	return 'equal';
}

/* -------------------------------------------------------------------- */
/*  The model                                                            */
/* -------------------------------------------------------------------- */

const DEFAULT_CONTEXT_LINES = 3;

/** Hunks → rows, sections and counts. Pure, and cheap enough to re-run. */
export function buildDiffModel(
	hunks: DiffHunk[],
	options: BuildDiffModelOptions = {},
): DiffModel {
	const granularity = options.granularity ?? 'word';
	const rows: DiffRow[] = [];

	let before_line = 0;
	let after_line = 0;

	// Which moves came with a stub. The old side's line numbers belong to
	// whichever end stands where the old document put the span: the stub when
	// there is one, and the span itself when there is not.
	const stubbed = new Set<string>();
	for (const hunk of hunks) {
		if (hunk.kind === 'moved' && hunk.stub) stubbed.add(moveID(hunk));
	}

	hunks.forEach((hunk, index) => {
		const moved = hunk.kind === 'moved';
		const moved_from = moved ? (hunk.before_index ?? null) : null;
		const moved_to = moved ? (hunk.after_index ?? null) : null;
		const moved_changed = moved && (hunk.changed ?? hunk.before !== hunk.after);

		if (moved && hunk.stub) {
			// A stub is matched to its span by its two indices and by nothing
			// else, so a stub without them cannot be matched at all — and every
			// such stub folds onto the same `moveID`, which is worse than
			// unmatched: two of them pair with each other's span and every marker
			// points at the wrong row.
			//
			// Thrown rather than gated behind a dev flag, for the reason
			// `diffStructured` throws on a duplicate key by default: it is a
			// caller mistake, it is deterministic, and guessing quietly hides it.
			// (`import.meta.env.DEV` is also not available to a package that has
			// to work outside Vite, and the usual way round it is a dependency.)
			if (hunk.before_index == null || hunk.after_index == null) {
				throw new DiffError(
					'A `moved` hunk with `stub: true` needs both `before_index` and ' +
						'`after_index` — they are the only thing that matches a stub to its span.',
					'stub_without_indices',
				);
			}
			// One row, but every line the span occupied in the old document is
			// counted off — otherwise every line number below a move is short by
			// the height of what moved.
			const first = before_line + 1;
			before_line += Math.max(splitLines(hunk.before ?? '').length, 1);
			rows.push({
				kind: 'equal',
				before_line: first,
				after_line: null,
				before_ops: [],
				after_ops: [],
				hunk: index,
				key: hunk.key ?? null,
				moved: true,
				moved_from,
				moved_to,
				moved_stub: true,
				moved_head: true,
				moved_changed,
				moved_from_line: null,
				moved_to_line: null,
			});
			return;
		}

		const suppress_before = moved && stubbed.has(moveID(hunk));
		let head = true;
		for (const seed of seedsForHunk(hunk, granularity)) {
			const kind = kindOf(seed);
			const has_before = seed.before !== null;
			const has_after = seed.after !== null;
			rows.push({
				kind,
				before_line: has_before && !suppress_before ? ++before_line : null,
				after_line: has_after ? ++after_line : null,
				before_ops: seed.before ?? [],
				after_ops: seed.after ?? [],
				hunk: index,
				key: hunk.key ?? null,
				moved,
				moved_from,
				moved_to,
				moved_stub: false,
				moved_head: moved && head,
				moved_changed,
				moved_from_line: null,
				moved_to_line: null,
			});
			head = false;
		}
	});

	resolveMoveLines(rows);

	const stats: DiffStats = { added: 0, removed: 0, changed: 0, moved: 0, unchanged: 0 };
	for (const row of rows) {
		// A stub is the same move the span already counted, drawn at the other
		// end. Counting it would report every move twice.
		if (row.moved_stub) continue;
		if (row.moved) stats.moved++;
		if (row.kind === 'insert') stats.added++;
		else if (row.kind === 'delete') stats.removed++;
		else if (row.kind === 'replace') stats.changed++;
		else if (!row.moved) stats.unchanged++;
	}

	const changes: number[] = [];
	for (let i = 0; i < rows.length; i++) {
		if (!isChange(rows[i])) continue;
		if (i === 0 || !isChange(rows[i - 1]) || startsMoveEnd(rows[i])) changes.push(i);
	}

	return {
		rows,
		sections: sectionize(rows, options.context_lines ?? DEFAULT_CONTEXT_LINES),
		stats,
		changes,
		changes_set: new Set(changes),
		changed: changes.length > 0,
	};
}

function isChange(row: DiffRow): boolean {
	return row.kind !== 'equal' || row.moved;
}

/**
 * A move's ends are always their own stop, even when they touch.
 *
 * `n` and `p` step to the head of each *run* of change, which is right for the
 * ordinary case: eight rewritten lines in a row are one edit to read, not
 * eight. A move is the exception. Its two ends are one stop apart in the two
 * commonest cases there are — two adjacent blocks swapped, and a block that
 * moved past exactly one neighbour — and they are the two halves of the
 * question the reader is asking. Folding them into one run means `n` lands on
 * the stub, says "moved to line 3", and the next `n` skips the line it was
 * pointing at.
 */
function startsMoveEnd(row: DiffRow): boolean {
	return row.moved && (row.moved_stub || row.moved_head);
}

/** The two ends of one move, named the same way from either end. */
function moveID(span: {
	before_index?: number | null;
	after_index?: number | null;
}): string {
	return `${span.before_index ?? ''} ${span.after_index ?? ''}`;
}

/**
 * Let the two ends of each move name each other's line.
 *
 * A stub knows where its span *was* — it is standing there — and the span knows
 * where it is now; neither knows the other's number until both have been laid
 * out, because a move can go either way and the second end is as often above as
 * below. So it is a second pass: match on `moved_from` / `moved_to`, then copy
 * each end's line onto the other. The span's whole hunk is filled in, not just
 * its head, so a renderer can label any row of it.
 */
function resolveMoveLines(rows: DiffRow[]): void {
	const stubs = new Map<string, number>();
	const heads = new Map<string, number>();
	rows.forEach((row, index) => {
		if (!row.moved) return;
		// Nothing to match on. A `moved` hunk that came without a stub and
		// without indices is the pre-stub shape and pairs with nobody; a *stub*
		// in this state has already thrown.
		if (row.moved_from === null && row.moved_to === null) return;
		const id = moveID({ before_index: row.moved_from, after_index: row.moved_to });
		if (row.moved_stub) stubs.set(id, index);
		else if (row.moved_head) heads.set(id, index);
	});

	for (const [id, stub_index] of stubs) {
		const head_index = heads.get(id);
		if (head_index === undefined) continue;
		const stub = rows[stub_index];
		const head = rows[head_index];
		stub.moved_from_line = stub.before_line;
		stub.moved_to_line = head.after_line;
		for (let i = head_index; i < rows.length && rows[i].hunk === head.hunk; i++) {
			rows[i].moved_from_line = stub.before_line;
			rows[i].moved_to_line = head.after_line;
		}
	}
}

/**
 * Group rows into shown and collapsed runs.
 *
 * A run of unchanged rows keeps `context_lines` at each end that touches a
 * change, and collapses what is left in the middle. Only when there is
 * something left: collapsing one row behind a button that says "show 1
 * unchanged line" costs a click and saves a line.
 */
export function sectionize(rows: DiffRow[], context_lines: number): DiffSection[] {
	if (rows.length === 0) return [];
	if (!Number.isFinite(context_lines) || context_lines < 0) {
		return [{ kind: 'rows', rows }];
	}
	// Nothing changed, so there is no context to be context *to*. Hiding the
	// whole document behind one expander answers "what changed?" with a button.
	if (!rows.some(isChange)) return [{ kind: 'rows', rows }];
	const context = Math.floor(context_lines);
	const sections: DiffSection[] = [];
	const shown: DiffRow[] = [];

	const flushShown = () => {
		if (shown.length === 0) return;
		sections.push({ kind: 'rows', rows: shown.splice(0, shown.length) });
	};

	let i = 0;
	while (i < rows.length) {
		if (isChange(rows[i])) {
			shown.push(rows[i]);
			i++;
			continue;
		}
		let end = i;
		while (end < rows.length && !isChange(rows[end])) end++;
		const run = rows.slice(i, end);
		const head = i === 0 ? 0 : context;
		const tail = end === rows.length ? 0 : context;
		if (run.length - head - tail > 1) {
			for (let j = 0; j < head; j++) shown.push(run[j]);
			flushShown();
			const hidden = run.slice(head, run.length - tail);
			sections.push({ kind: 'collapsed', rows: hidden, count: hidden.length });
			for (let j = run.length - tail; j < run.length; j++) shown.push(run[j]);
		} else {
			for (const row of run) shown.push(row);
		}
		i = end;
	}
	flushShown();
	return sections;
}

/**
 * One row's two sides woven back into a single stream, for inline rendering.
 *
 * `before_ops` and `after_ops` were split out of one op sequence and share
 * their `equal` spans, so walking them together puts the sequence back: at each
 * divergence the deletion is emitted before the insertion, which is the order
 * `@delightstack/diff` guarantees within a changed region anyway.
 */
export function mergeRowOps(row: Pick<DiffRow, 'before_ops' | 'after_ops'>): DiffOp[] {
	const merged: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < row.before_ops.length || j < row.after_ops.length) {
		const before = row.before_ops[i];
		const after = row.after_ops[j];
		if (before?.type === 'delete') {
			merged.push(before);
			i++;
		} else if (after?.type === 'insert') {
			merged.push(after);
			j++;
		} else if (before && after) {
			merged.push(before);
			i++;
			j++;
		} else if (before) {
			merged.push(before);
			i++;
		} else if (after) {
			merged.push(after);
			j++;
		}
	}
	return merged;
}

/** The next change at or after `row`, wrapping. `-1` when there are none. */
export function nextChange(model: DiffModel, row: number): number {
	if (model.changes.length === 0) return -1;
	return model.changes.find((index) => index > row) ?? model.changes[0];
}

/** The previous change before `row`, wrapping. `-1` when there are none. */
export function previousChange(model: DiffModel, row: number): number {
	if (model.changes.length === 0) return -1;
	for (let i = model.changes.length - 1; i >= 0; i--) {
		if (model.changes[i] < row) return model.changes[i];
	}
	return model.changes[model.changes.length - 1];
}
