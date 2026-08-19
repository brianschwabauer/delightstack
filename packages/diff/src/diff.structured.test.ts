import { describe, expect, it } from 'vitest';
import { DiffError } from './diff.error';
import { diffStructured, type StructuredChange } from './diff.structured';

interface Block {
	id: string;
	text: string;
}

/** Build blocks from a compact `id:text` spec — `'a'` means id `a`, text `a`. */
function blocks(...specs: string[]): Block[] {
	return specs.map((spec) => {
		const separator = spec.indexOf(':');
		if (separator === -1) return { id: spec, text: spec };
		return { id: spec.slice(0, separator), text: spec.slice(separator + 1) };
	});
}

function blockKey(block: Block): string {
	return block.id;
}

/** `type:key` for every change, in order — the shape assertions read better this way. */
function summarize(changes: StructuredChange<Block>[]): string[] {
	return changes.map((change) => `${change.type}:${change.key}`);
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

/** Reference LCS length via a naive DP table — only ever run on tiny inputs. */
function lcsLength(a: string[], b: string[]): number {
	const table: number[][] = Array.from(
		{ length: a.length + 1 },
		() => new Array<number>(b.length + 1).fill(0),
	);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			table[i][j] =
				a[i - 1] === b[j - 1]
					? table[i - 1][j - 1] + 1
					: Math.max(table[i - 1][j], table[i][j - 1]);
		}
	}
	return table[a.length][b.length];
}

describe('diffStructured — degenerate inputs', () => {
	it('handles two empty sequences', () => {
		const result = diffStructured<Block>([], [], blockKey);
		expect(result.changes).toEqual([]);
		expect(result.changed).toBe(false);
		expect(result.counts).toEqual({ unchanged: 0, inserted: 0, deleted: 0, moved: 0 });
	});

	it('reports everything inserted when the old sequence is empty', () => {
		const result = diffStructured([], blocks('a', 'b'), blockKey);
		expect(summarize(result.changes)).toEqual(['inserted:a', 'inserted:b']);
		expect(result.changes[0].old_index).toBe(-1);
		expect(result.changes[0].old_item).toBeUndefined();
		expect(result.changes[1].new_index).toBe(1);
		expect(result.changed).toBe(true);
	});

	it('reports everything deleted when the new sequence is empty', () => {
		const result = diffStructured(blocks('a', 'b'), [], blockKey);
		expect(summarize(result.changes)).toEqual(['deleted:a', 'deleted:b']);
		expect(result.changes[0].new_index).toBe(-1);
		expect(result.changes[0].new_item).toBeUndefined();
		expect(result.changed).toBe(true);
	});

	it('reports an identical sequence as entirely unchanged', () => {
		const items = blocks('a', 'b', 'c');
		const result = diffStructured(items, items, blockKey);
		expect(summarize(result.changes)).toEqual(['unchanged:a', 'unchanged:b', 'unchanged:c']);
		expect(result.changed).toBe(false);
		expect(result.counts.unchanged).toBe(3);
	});
});

describe('diffStructured — moves', () => {
	it('detects a pure move rather than a delete plus an insert', () => {
		const result = diffStructured(blocks('a', 'b', 'c'), blocks('c', 'a', 'b'), blockKey);
		expect(summarize(result.changes)).toEqual(['moved:c', 'unchanged:a', 'unchanged:b']);
		expect(result.counts).toEqual({ unchanged: 2, inserted: 0, deleted: 0, moved: 1 });
		const moved = result.changes[0];
		expect(moved.type).toBe('moved');
		expect(moved.old_index).toBe(2);
		expect(moved.new_index).toBe(0);
		expect(result.changed).toBe(true);
	});

	it('moves the minority when a block jumps across many', () => {
		const result = diffStructured(
			blocks('a', 'b', 'c', 'd', 'e'),
			blocks('a', 'b', 'd', 'e', 'c'),
			blockKey,
		);
		expect(result.counts).toEqual({ unchanged: 4, inserted: 0, deleted: 0, moved: 1 });
		const moved = result.changes.find((change) => change.type === 'moved');
		expect(moved?.key).toBe('c');
		expect(moved?.old_index).toBe(2);
		expect(moved?.new_index).toBe(4);
	});

	it('carries both versions of a block that moved and was edited', () => {
		const result = diffStructured(
			blocks('a:first', 'b:second', 'c:third'),
			blocks('c:third rewritten', 'a:first', 'b:second'),
			blockKey,
		);
		const moved = result.changes[0];
		expect(moved.type).toBe('moved');
		expect(moved.old_item?.text).toBe('third');
		expect(moved.new_item?.text).toBe('third rewritten');
	});

	it('reports an edited but stationary block as unchanged, with both versions', () => {
		// `unchanged` is about identity and position, never about content — the caller
		// compares `old_item` / `new_item` (with diffWords, say) to see what the body did.
		const result = diffStructured(blocks('a:before'), blocks('a:after'), blockKey);
		expect(summarize(result.changes)).toEqual(['unchanged:a']);
		expect(result.changed).toBe(false);
		const change = result.changes[0];
		expect(change.old_item?.text).toBe('before');
		expect(change.new_item?.text).toBe('after');
	});

	it('detects a swap of two adjacent blocks', () => {
		const result = diffStructured(blocks('a', 'b'), blocks('b', 'a'), blockKey);
		expect(result.counts.moved).toBe(1);
		expect(result.counts.unchanged).toBe(1);
		expect(result.counts.inserted + result.counts.deleted).toBe(0);
	});
});

describe('diffStructured — inserts and deletes around moves', () => {
	it('interleaves a deletion at the position it used to occupy', () => {
		const result = diffStructured(blocks('a', 'b', 'c'), blocks('a', 'c'), blockKey);
		expect(summarize(result.changes)).toEqual(['unchanged:a', 'deleted:b', 'unchanged:c']);
	});

	it('places an insertion at its new position', () => {
		const result = diffStructured(blocks('a', 'c'), blocks('a', 'b', 'c'), blockKey);
		expect(summarize(result.changes)).toEqual(['unchanged:a', 'inserted:b', 'unchanged:c']);
	});

	it('handles a move with an insert and a delete on either side', () => {
		const result = diffStructured(
			blocks('a', 'b', 'c', 'd'),
			blocks('d', 'a', 'x', 'c'),
			blockKey,
		);
		expect(result.counts).toEqual({ unchanged: 2, inserted: 1, deleted: 1, moved: 1 });
		expect(summarize(result.changes)).toEqual([
			'moved:d',
			'unchanged:a',
			'deleted:b',
			'inserted:x',
			'unchanged:c',
		]);
	});

	it('never reports a moved block as deleted', () => {
		const result = diffStructured(blocks('a', 'b', 'c'), blocks('b', 'c', 'a'), blockKey);
		expect(result.counts.deleted).toBe(0);
		expect(result.counts.inserted).toBe(0);
		expect(result.counts.moved).toBe(1);
	});

	it('reports a full replacement as deletes then inserts', () => {
		const result = diffStructured(blocks('a', 'b'), blocks('x', 'y'), blockKey);
		expect(summarize(result.changes)).toEqual([
			'deleted:a',
			'deleted:b',
			'inserted:x',
			'inserted:y',
		]);
	});
});

describe('diffStructured — duplicate keys', () => {
	it('throws a DiffError by default', () => {
		const duplicated = blocks('a', 'b', 'a');
		expect(() => diffStructured(duplicated, blocks('a'), blockKey)).toThrow(DiffError);
		try {
			diffStructured(duplicated, blocks('a'), blockKey);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(DiffError);
			expect((error as DiffError).code).toBe('duplicate_key');
			expect((error as DiffError).status).toBe(400);
			expect((error as DiffError).message).toContain('old sequence');
		}
	});

	it('names the offending side', () => {
		try {
			diffStructured(blocks('a'), blocks('a', 'a'), blockKey);
			expect.unreachable();
		} catch (error) {
			expect((error as DiffError).message).toContain('new sequence');
		}
	});

	it('pairs repeats by occurrence under duplicate_keys: "index"', () => {
		const result = diffStructured(
			blocks('a:one', 'a:two', 'b'),
			blocks('a:one', 'a:two changed', 'b'),
			blockKey,
			{ duplicate_keys: 'index' },
		);
		expect(result.counts).toEqual({ unchanged: 3, inserted: 0, deleted: 0, moved: 0 });
		expect(result.changes[1].old_item?.text).toBe('two');
		expect(result.changes[1].new_item?.text).toBe('two changed');
	});

	it('treats an extra repeat as an insert under duplicate_keys: "index"', () => {
		const result = diffStructured(blocks('a'), blocks('a', 'a'), blockKey, {
			duplicate_keys: 'index',
		});
		expect(result.counts).toEqual({ unchanged: 1, inserted: 1, deleted: 0, moved: 0 });
	});

	it('treats a removed repeat as a delete under duplicate_keys: "index"', () => {
		const result = diffStructured(blocks('a', 'a'), blocks('a'), blockKey, {
			duplicate_keys: 'index',
		});
		expect(result.counts).toEqual({ unchanged: 1, inserted: 0, deleted: 1, moved: 0 });
	});
});

describe('diffStructured — properties', () => {
	const KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

	function randomSequence(random: () => number): Block[] {
		const available = KEYS.slice();
		const count = Math.floor(random() * (available.length + 1));
		const chosen: Block[] = [];
		for (let i = 0; i < count; i++) {
			const index = Math.floor(random() * available.length);
			const [id] = available.splice(index, 1);
			chosen.push({ id, text: id });
		}
		return chosen;
	}

	it('accounts for every item exactly once, in render order', () => {
		const random = makeRandom(0x57_4c70);
		for (let case_index = 0; case_index < 500; case_index++) {
			const old_items = randomSequence(random);
			const new_items = randomSequence(random);
			const result = diffStructured(old_items, new_items, blockKey);

			// Every old item appears exactly once, as deleted, moved or unchanged.
			const old_seen = result.changes
				.filter((change) => change.type !== 'inserted')
				.map((change) => change.old_index)
				.sort((a, b) => a - b);
			expect(old_seen).toEqual(old_items.map((_, index) => index));

			// Every new item appears exactly once, and in new-sequence order.
			const new_seen = result.changes
				.filter((change) => change.type !== 'deleted')
				.map((change) => change.new_index);
			expect(new_seen).toEqual(new_items.map((_, index) => index));

			// Deletions are interleaved in ascending old order.
			const deleted_indices = result.changes
				.filter((change) => change.type === 'deleted')
				.map((change) => change.old_index);
			expect(deleted_indices).toEqual(deleted_indices.slice().sort((a, b) => a - b));

			// Counts agree with the change list, and `changed` agrees with the counts.
			expect(result.counts.unchanged + result.counts.moved + result.counts.deleted).toBe(
				old_items.length,
			);
			expect(result.counts.unchanged + result.counts.moved + result.counts.inserted).toBe(
				new_items.length,
			);
			expect(result.changed).toBe(
				result.counts.inserted + result.counts.deleted + result.counts.moved > 0,
			);
		}
	});

	it('keeps the largest possible spine (matches a naive LCS reference)', () => {
		const random = makeRandom(0x5b_11e0);
		for (let case_index = 0; case_index < 500; case_index++) {
			const old_items = randomSequence(random);
			const new_items = randomSequence(random);
			const result = diffStructured(old_items, new_items, blockKey);
			expect(result.counts.unchanged).toBe(
				lcsLength(old_items.map(blockKey), new_items.map(blockKey)),
			);
		}
	});

	it('reports no change for a sequence diffed against itself', () => {
		const random = makeRandom(0x1de17);
		for (let case_index = 0; case_index < 200; case_index++) {
			const items = randomSequence(random);
			const result = diffStructured(items, items, blockKey);
			expect(result.changed).toBe(false);
			expect(result.counts.unchanged).toBe(items.length);
		}
	});
});
