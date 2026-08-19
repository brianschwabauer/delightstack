/**
 * Key-based structural diff with move detection.
 *
 * Given two sequences of items that carry a stable identity (a block ID, a row ID, a file
 * path), work out which items were inserted, deleted, moved, or left in place. A text diff
 * cannot do this: reordering two paragraphs looks like deleting one and inserting it again.
 *
 * The algorithm: intersect the two key sequences, then take the **longest increasing
 * subsequence** of the old-side positions of the surviving items. That subsequence is the
 * largest set of items whose relative order is unchanged, so it becomes the stable spine;
 * every other surviving item moved. LIS is used rather than a general LCS because keys are
 * unique within a sequence (see `duplicate_keys`), which makes them equivalent and lets the
 * whole thing run in O(n log n) instead of O(n·m).
 */

import { DiffError } from './diff.error';

/**
 * Separator between a repeated key and its occurrence number under `duplicate_keys: 'index'`.
 * A NUL, because no sane stable identifier contains one.
 */
const DUPLICATE_KEY_SEPARATOR = '\u0000';

/** What happened to one item between the two sequences. */
export type StructuredChangeType = 'unchanged' | 'inserted' | 'deleted' | 'moved';

/**
 * One item's fate.
 *
 * A discriminated union on `type`, so `old_item` / `new_item` narrow correctly:
 *
 * - `unchanged` — the key is present in both sequences and sits on the stable spine.
 *   **This says nothing about the item's *content*.** Both `old_item` and `new_item` are
 *   supplied precisely so the caller can compare them (with `diffWords`, say) and decide
 *   whether the body changed. Identity is what this diff tracks; content is the caller's.
 * - `moved` — the key is present in both sequences but not on the spine: its position
 *   relative to the surviving items changed. `old_index` and `new_index` are both real.
 * - `inserted` — the key appears only in the new sequence. `old_index` is `-1`.
 * - `deleted` — the key appears only in the old sequence. `new_index` is `-1`.
 */
export type StructuredChange<T> =
	| {
			type: 'unchanged';
			key: string;
			old_index: number;
			new_index: number;
			old_item: T;
			new_item: T;
	  }
	| {
			type: 'moved';
			key: string;
			old_index: number;
			new_index: number;
			old_item: T;
			new_item: T;
	  }
	| {
			type: 'inserted';
			key: string;
			old_index: -1;
			new_index: number;
			old_item: undefined;
			new_item: T;
	  }
	| {
			type: 'deleted';
			key: string;
			old_index: number;
			new_index: -1;
			old_item: T;
			new_item: undefined;
	  };

/** The result of {@link diffStructured}. */
export interface StructuredDiff<T> {
	/**
	 * Every item from both sequences, exactly once each, in render order: the new sequence's
	 * order, with each deleted item spliced in at the point it used to occupy relative to its
	 * surviving neighbours. Rendering `changes` top to bottom therefore produces a readable
	 * unified diff with no further sorting.
	 */
	changes: StructuredChange<T>[];
	/** How many changes of each type `changes` contains. */
	counts: Record<StructuredChangeType, number>;
	/** `false` only when both sequences have the same keys in the same order. */
	changed: boolean;
}

export interface StructuredDiffOptions {
	/**
	 * What to do when one sequence contains the same key twice.
	 *
	 * - `'throw'` (default) — throw a {@link DiffError} with code `duplicate_key`. Keys are
	 *   meant to be stable identities; a repeat is almost always a bug upstream (a block ID
	 *   duplicated by a copy-paste, say) and silently guessing hides it.
	 * - `'index'` — deterministically disambiguate: the *n*-th occurrence of a key is matched
	 *   against the *n*-th occurrence of that key in the other sequence. Extra occurrences on
	 *   one side become inserts or deletes. No throw, no ambiguity, order-independent.
	 */
	duplicate_keys?: 'throw' | 'index';
}

/**
 * Diff two sequences by stable key, detecting moves.
 *
 * ```ts
 * const result = diffStructured(old_blocks, new_blocks, (block) => block.id);
 * for (const change of result.changes) {
 *   if (change.type === 'moved') console.log(change.key, change.old_index, '→', change.new_index);
 * }
 * ```
 *
 * @param old_items the sequence as it was
 * @param new_items the sequence as it is
 * @param key extracts each item's stable identity; must be pure and total
 * @throws {DiffError} `duplicate_key` — a key repeats within one sequence and
 *   `options.duplicate_keys` is `'throw'` (the default)
 */
export function diffStructured<T>(
	old_items: readonly T[],
	new_items: readonly T[],
	key: (item: T) => string,
	options: StructuredDiffOptions = {},
): StructuredDiff<T> {
	const duplicate_keys = options.duplicate_keys ?? 'throw';
	const old_keys = resolveKeys(old_items, key, duplicate_keys, 'old');
	const new_keys = resolveKeys(new_items, key, duplicate_keys, 'new');

	// Where does each old key live? Unique by construction after `resolveKeys`.
	const old_positions = new Map<string, number>();
	for (let i = 0; i < old_keys.length; i++) old_positions.set(old_keys[i], i);

	// The surviving items, in new-sequence order, paired with their old position.
	const survivor_new_indices: number[] = [];
	const survivor_old_indices: number[] = [];
	for (let j = 0; j < new_keys.length; j++) {
		const old_index = old_positions.get(new_keys[j]);
		if (old_index === undefined) continue;
		survivor_new_indices.push(j);
		survivor_old_indices.push(old_index);
	}

	// The stable spine: the longest run of survivors whose old order is preserved.
	const spine = longestIncreasingSubsequence(survivor_old_indices);
	const spine_new_indices = new Set<number>();
	for (const position of spine) spine_new_indices.add(survivor_new_indices[position]);

	// Anchors, in order, drive the interleaving of deletions into the new-order walk.
	const anchors: Array<{ old_index: number; new_index: number }> = [];
	for (const position of spine) {
		anchors.push({
			old_index: survivor_old_indices[position],
			new_index: survivor_new_indices[position],
		});
	}

	const new_key_set = new Set(new_keys);
	const changes: StructuredChange<T>[] = [];
	const counts: Record<StructuredChangeType, number> = {
		unchanged: 0,
		inserted: 0,
		deleted: 0,
		moved: 0,
	};

	const pushChange = (change: StructuredChange<T>): void => {
		changes.push(change);
		counts[change.type]++;
	};

	/** Emit the old-side items in `[from, to)` that are gone for good. */
	const emitDeletions = (from: number, to: number): void => {
		for (let i = from; i < to; i++) {
			// An old item that still exists somewhere in the new sequence has not been
			// deleted — it moved, and is emitted at its new position instead.
			if (new_key_set.has(old_keys[i])) continue;
			pushChange({
				type: 'deleted',
				key: old_keys[i],
				old_index: i,
				new_index: -1,
				old_item: old_items[i],
				new_item: undefined,
			});
		}
	};

	/** Emit the new-side items in `[from, to)` that are off the spine. */
	const emitNewSide = (from: number, to: number): void => {
		for (let j = from; j < to; j++) {
			const old_index = old_positions.get(new_keys[j]);
			if (old_index === undefined) {
				pushChange({
					type: 'inserted',
					key: new_keys[j],
					old_index: -1,
					new_index: j,
					old_item: undefined,
					new_item: new_items[j],
				});
			} else {
				pushChange({
					type: 'moved',
					key: new_keys[j],
					old_index,
					new_index: j,
					old_item: old_items[old_index],
					new_item: new_items[j],
				});
			}
		}
	};

	let old_cursor = 0;
	let new_cursor = 0;
	for (const anchor of anchors) {
		emitDeletions(old_cursor, anchor.old_index);
		emitNewSide(new_cursor, anchor.new_index);
		pushChange({
			type: 'unchanged',
			key: new_keys[anchor.new_index],
			old_index: anchor.old_index,
			new_index: anchor.new_index,
			old_item: old_items[anchor.old_index],
			new_item: new_items[anchor.new_index],
		});
		old_cursor = anchor.old_index + 1;
		new_cursor = anchor.new_index + 1;
	}
	emitDeletions(old_cursor, old_keys.length);
	emitNewSide(new_cursor, new_keys.length);

	return {
		changes,
		counts,
		changed: counts.inserted + counts.deleted + counts.moved > 0,
	};
}

/**
 * Extract each item's key, enforcing (or manufacturing) uniqueness within the sequence.
 *
 * Under `'index'`, the *n*-th repeat of `k` becomes the internal key `k\u0000n`. The
 * separator is a NUL, which no sane stable ID contains; a caller who does use NULs in keys
 * gets the same deterministic pairing anyway, just with a different collision story.
 * Returned keys are the internal ones, so they are what surfaces in `StructuredChange.key`
 * — documented, and the reason `'throw'` is the default.
 */
function resolveKeys<T>(
	items: readonly T[],
	key: (item: T) => string,
	duplicate_keys: 'throw' | 'index',
	side: 'old' | 'new',
): string[] {
	const keys: string[] = [];
	const seen = new Map<string, number>();
	for (let i = 0; i < items.length; i++) {
		const raw = key(items[i]);
		const occurrence = seen.get(raw) ?? 0;
		seen.set(raw, occurrence + 1);
		if (occurrence === 0) {
			keys.push(raw);
			continue;
		}
		if (duplicate_keys === 'throw') {
			throw new DiffError(
				`Duplicate key ${JSON.stringify(raw)} at index ${i} of the ${side} sequence. ` +
					`Keys must be unique within a sequence; pass { duplicate_keys: 'index' } to ` +
					`pair repeats by occurrence instead.`,
				'duplicate_key',
			);
		}
		keys.push(`${raw}${DUPLICATE_KEY_SEPARATOR}${occurrence}`);
	}
	return keys;
}

/**
 * Indices of a longest strictly-increasing subsequence of `values`, in ascending order.
 *
 * Patience-sorting variant: O(n log n) time, O(n) space. Ties are broken towards the
 * earliest run, so a block that stayed put reads as unchanged and the block that jumped
 * over it reads as moved — rather than the other way round.
 */
function longestIncreasingSubsequence(values: number[]): number[] {
	if (values.length === 0) return [];

	// tails[l] = index into `values` of the smallest tail of an increasing run of length l+1.
	const tails: number[] = [];
	const previous = new Int32Array(values.length).fill(-1);

	for (let i = 0; i < values.length; i++) {
		let low = 0;
		let high = tails.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (values[tails[mid]] < values[i]) low = mid + 1;
			else high = mid;
		}
		if (low > 0) previous[i] = tails[low - 1];
		if (low === tails.length) tails.push(i);
		else tails[low] = i;
	}

	const result: number[] = [];
	let cursor = tails[tails.length - 1];
	while (cursor !== -1) {
		result.push(cursor);
		cursor = previous[cursor];
	}
	return result.reverse();
}
