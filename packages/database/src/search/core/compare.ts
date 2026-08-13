/**
 * THE comparator — the single most consistency-critical module in the engine.
 *
 * Every user-visible ordering (search results, facet values, distinct groups)
 * goes through here, on every driver. See
 * `plans/database/Native Search Engine Plan.md` §4.6.
 *
 * Constraints this module exists to enforce:
 * - Strings compare by Unicode **code point**, never by JS `<` (which is
 *   UTF-16 code-unit order and diverges for astral-plane characters). SQLite's
 *   BINARY collation over UTF-8 is code-point order, so the JS side must match
 *   SQLite — not the other way around.
 * - `null`/missing sort LAST regardless of direction (SQLite would put NULLs
 *   first on ASC; the SQL compiler emits `ORDER BY col IS NULL, col` to agree
 *   with this rule).
 * - Every final ordering ends with a primary-key ascending tie-break, compared
 *   as the PK's *declared* type (`2 < 10` for numeric PKs, `'10' < '2'` for
 *   string PKs).
 */

/** The direction of a single ordering instruction */
export type SortDirection = 'ASC' | 'DESC';

/** The declared type of a table's primary key */
export type PrimaryKeyType = 'string' | 'number';

/**
 * Type rank used when two compared values have different JS types. Fixed and
 * total so mixed-type columns still produce a deterministic order.
 */
const TYPE_RANK: Record<string, number> = {
	boolean: 0,
	number: 1,
	string: 2,
	object: 3,
};

/** True when a value is absent for ordering purposes (`null`/`undefined`/`NaN`). */
export function isNullish(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		(typeof value === 'number' && Number.isNaN(value))
	);
}

/**
 * Compare two strings in Unicode code-point order.
 *
 * NOT `a < b`: JS string relational operators compare UTF-16 code units, which
 * orders astral-plane characters (emoji, rare CJK) before U+E000–U+FFFF instead
 * of after them. SQLite's BINARY collation over UTF-8 orders by code point, so
 * this is the definition both sides share.
 */
export function compareStrings(a: string, b: string): number {
	if (a === b) return 0;
	const shared = Math.min(a.length, b.length);
	let index = 0;
	// Code UNIT scan, which is what a JIT can make fast. It is not a shortcut
	// that trades accuracy for speed: a code unit that is not a HIGH surrogate is
	// a whole code point on its own, and for those two classes unit order and
	// code-point order are the same order. The moment a high surrogate appears on
	// either side — where a pair sorts below U+E000 by unit but above it by code
	// point — the comparison hands off to the code-point walk.
	//
	// The handoff has to trigger on *equal* high surrogates too, not only on a
	// difference: JS strings may hold LONE surrogates, so `"a\ud800�"` and
	// `"a𐀀"` share the unit `\ud800` while the second pairs it into
	// U+10000 and the first does not. Comparing the following units would then be
	// comparing a code point against half of one. And the walk restarts from the
	// beginning, so it never has to reason about whether `index` landed inside a
	// surrogate pair.
	while (index < shared) {
		const unit_a = a.charCodeAt(index);
		const unit_b = b.charCodeAt(index);
		if ((unit_a & 0xfc00) === 0xd800 || (unit_b & 0xfc00) === 0xd800) {
			return compareByCodePoint(a, b, shared);
		}
		if (unit_a !== unit_b) return unit_a < unit_b ? -1 : 1;
		index++;
	}
	if (a.length === b.length) return 0;
	return a.length < b.length ? -1 : 1;
}

/** {@link compareStrings}'s definition, walked one code point at a time. */
function compareByCodePoint(a: string, b: string, shared: number): number {
	let index = 0;
	while (index < shared) {
		const code_a = a.codePointAt(index) as number;
		const code_b = b.codePointAt(index) as number;
		if (code_a !== code_b) return code_a < code_b ? -1 : 1;
		// Equal code points consume the same number of code units on both sides.
		index += code_a > 0xffff ? 2 : 1;
	}
	if (a.length === b.length) return 0;
	return a.length < b.length ? -1 : 1;
}

/**
 * Compare two non-null values of any supported scalar type.
 *
 * Numbers compare numerically, booleans as `false < true`, strings by code
 * point. Values of differing types fall back to a fixed type rank so the
 * comparator stays total (and therefore deterministic) on mixed columns.
 */
export function compareValues(a: unknown, b: unknown): number {
	const type_a = typeof a;
	const type_b = typeof b;
	if (type_a !== type_b) {
		const rank_a = TYPE_RANK[type_a] ?? 4;
		const rank_b = TYPE_RANK[type_b] ?? 4;
		if (rank_a !== rank_b) return rank_a < rank_b ? -1 : 1;
		return 0;
	}
	if (type_a === 'number') {
		const num_a = a as number;
		const num_b = b as number;
		// NaN compares symmetrically and sorts LAST (like `null` and like
		// `comparePrimaryKeys`), keeping the comparator total. The ORDER path
		// never gets here with NaN — `compareForOrder` screens it via `isNullish`
		// — so this only shapes filter-path comparisons over dirty data.
		const nan_a = Number.isNaN(num_a);
		const nan_b = Number.isNaN(num_b);
		if (nan_a || nan_b) {
			if (nan_a && nan_b) return 0;
			return nan_a ? 1 : -1;
		}
		if (num_a === num_b) return 0;
		return num_a < num_b ? -1 : 1;
	}
	if (type_a === 'boolean') {
		if (a === b) return 0;
		return a === false ? -1 : 1;
	}
	if (type_a === 'string') return compareStrings(a as string, b as string);
	// Objects/arrays are not orderable values in the DSL; treat as equal so the
	// PK tie-break decides.
	return 0;
}

/**
 * Compare two values for an `order[]` instruction.
 *
 * `null`/missing always sorts LAST — the direction flips the comparison of
 * present values only.
 */
export function compareForOrder(
	a: unknown,
	b: unknown,
	direction: SortDirection = 'ASC',
): number {
	const a_null = isNullish(a);
	const b_null = isNullish(b);
	if (a_null && b_null) return 0;
	if (a_null) return 1;
	if (b_null) return -1;
	const result = compareValues(a, b);
	return direction === 'DESC' ? -result : result;
}

/**
 * Compare two primary keys as their declared type.
 *
 * Postings store `doc_id` as `String(pk)`, so numeric PKs must be re-read as
 * numbers here or `10` would sort before `2`.
 */
export function comparePrimaryKeys(
	a: string | number,
	b: string | number,
	type: PrimaryKeyType = 'string',
): number {
	if (type === 'number') {
		const num_a = typeof a === 'number' ? a : Number(a);
		const num_b = typeof b === 'number' ? b : Number(b);
		if (num_a === num_b) return 0;
		if (Number.isNaN(num_a)) return Number.isNaN(num_b) ? 0 : 1;
		if (Number.isNaN(num_b)) return -1;
		return num_a < num_b ? -1 : 1;
	}
	return compareStrings(String(a), String(b));
}
