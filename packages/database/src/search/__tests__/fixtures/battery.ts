/**
 * The query battery.
 *
 * One named, tagged case per behaviour the native search engine has to get
 * right. Both consumers read this array:
 *
 * - the **differential harness** (plan §8.1) runs every case through the native
 *   core and through Orama 3.1.18, selecting assertion strictness from the
 *   tags (exact membership for `filter-only`, rank-order for `scored`, no
 *   parity at all for `orama-bug` / `deviation` / `server-only`);
 * - the **golden-vector suite** (plan §8.2) runs every case through the memory
 *   reference, the server driver and the client driver and demands byte-
 *   identical output.
 *
 * Every case is written in the **owned** DSL (plan §6): `contains_all`,
 * `contains_any`, `not_in`, `distinct_on`, `fields`, `order[].field`,
 * `vector.field`. The pre-rename Orama spellings appear nowhere — there are no
 * legacy read aliases any more (decided 2026-08-12).
 *
 * ## Standalone by design
 *
 * `FixtureSearchQuery` below mirrors `core/types.ts` `SearchQuery` rather than
 * importing it, so this module compiles while `core/*` and `memory/*` are
 * still being written. Key spellings are identical, so a case's `query` is
 * assignable to `SearchQuery` once the harness wires the two together.
 */

import {
	ANTIMERIDIAN_POLYGON,
	GEO_BOUNDARY_RADIUS_M,
	GEO_CENTER,
	GEO_UNIT_METRES,
	POLYGON_BOX,
	TIED_UPDATED_AT,
	VECTOR_QUERY,
	type CorpusPresetName,
	type FixtureGeoPoint,
} from './corpus';

/* -------------------------------------------------------------------------- */
/* Query mirror types                                                         */
/* -------------------------------------------------------------------------- */

/** Mirror of `core/types.ts` `SearchOrder`. */
export interface FixtureOrder {
	field: string;
	direction?: 'ASC' | 'DESC';
}

/** Mirror of `core/types.ts` `SearchVectorQuery`. */
export interface FixtureVectorQuery {
	value: number[];
	field: string;
	/** Inclusive minimum cosine similarity, server-only. @default 0.8 */
	similarity?: number;
}

/**
 * A `where` clause. Values stay `unknown` because the battery deliberately
 * contains operand shapes that are *invalid* for their field type (the `error`
 * tagged cases) — typing them tightly would make those cases unwritable.
 */
export type FixtureWhere = Record<string, unknown>;

/** Mirror of `core/types.ts` `FacetDefinition` (all three variants). */
export type FixtureFacet =
	| { limit?: number; offset?: number; sort?: 'asc' | 'desc' | 'ASC' | 'DESC' }
	| { ranges: { from: number; to: number }[] }
	| { true?: boolean; false?: boolean };

/** Mirror of `core/types.ts` `SearchQuery`. */
export interface FixtureSearchQuery {
	term?: string;
	where?: FixtureWhere;
	order?: FixtureOrder[];
	limit?: number;
	offset?: number;
	facets?: Record<string, FixtureFacet>;
	boost?: Record<string, number>;
	fields?: '*' | string[];
	tolerance?: number;
	threshold?: number;
	exact?: boolean;
	distinct_on?: string;
	vector?: FixtureVectorQuery;
	sparse?: boolean;
	cursor?: string;
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The closed tag vocabulary. Harnesses select assertion strictness from these.
 *
 * - `filter-only` — no term, no vector: membership/count/facets must match
 *   Orama exactly.
 * - `scored` — a `term` participates: only rank-order/top-N membership is
 *   comparable (score values are a non-goal, plan §2).
 * - `deviation` — we intentionally differ from Orama 3.1.18; parity must NOT
 *   be asserted. The `notes` field says which finding.
 * - `orama-bug` — Orama's behaviour is known-broken (report findings A–E);
 *   parity must NOT be asserted.
 * - `orama-throws` — Orama raises where we return results (or vice versa);
 *   the harness must catch rather than compare.
 * - `error` — the native engine must throw `DelightError.badRequest`.
 * - `server-only` — vector/hybrid; never runs on the client driver.
 * - `defined-behavior-only` — the answer is whatever the frozen algorithm
 *   says, not what a geographer would expect (antimeridian polygons).
 */
export type BatteryTag =
	| 'filter-only'
	| 'scored'
	| 'facets'
	| 'order'
	| 'paging'
	| 'distinct'
	| 'geo'
	| 'geo-radius'
	| 'geo-polygon'
	| 'vector'
	| 'hybrid'
	| 'server-only'
	| 'orama-bug'
	| 'orama-throws'
	| 'deviation'
	| 'defined-behavior-only'
	| 'error'
	| 'shorthand'
	| 'composite'
	| 'array-field'
	| 'child-path'
	| 'null-handling'
	| 'tie-break'
	| 'tokenizer'
	| 'unicode'
	| 'empty-result'
	| 'integer-pk'
	| 'combination';

/** A single battery case. */
export interface BatteryCase {
	/** Unique, dot-namespaced, stable — golden fixtures key off this. */
	name: string;
	/** Which corpus preset the case is written against. */
	corpus: CorpusPresetName;
	query: FixtureSearchQuery;
	tags: BatteryTag[];
	/** Why the case exists / which plan or report finding it pins. */
	notes?: string;
}

function polygonCoordinates(points: FixtureGeoPoint[]): FixtureGeoPoint[] {
	return points.map((point) => ({ lat: point.lat, lon: point.lon }));
}

/* -------------------------------------------------------------------------- */
/* The battery                                                                */
/* -------------------------------------------------------------------------- */

function buildBattery(): BatteryCase[] {
	const cases: BatteryCase[] = [];
	const add = (
		name: string,
		query: FixtureSearchQuery,
		tags: BatteryTag[],
		options: { corpus?: CorpusPresetName; notes?: string } = {},
	): void => {
		cases.push({
			name,
			corpus: options.corpus ?? 'article',
			query,
			tags,
			notes: options.notes,
		});
	};

	/* ====================================================================== */
	/* where — scalar string                                                  */
	/* ====================================================================== */

	add('where.string.bare', { where: { title: 'baseline record' } }, [
		'filter-only',
		'shorthand',
	]);
	add(
		'where.string.eq',
		{ where: { title: { eq: 'baseline record' } } },
		['filter-only', 'deviation'],
		{ notes: 'Report §6: Orama returns the empty set for {eq} on a scalar string.' },
	);
	add('where.string.bare_array', { where: { title: ['pk two', 'pk ten'] } }, [
		'filter-only',
		'shorthand',
	]);
	add(
		'where.string.in',
		{ where: { title: { in: ['pk two', 'pk ten'] } } },
		['filter-only', 'deviation'],
		{ notes: 'Report §6: {in} on a string field is a silent empty set in Orama.' },
	);
	add('where.string.in_empty', { where: { title: { in: [] } } }, [
		'filter-only',
		'empty-result',
	]);
	add('where.string.not_in', { where: { title: { not_in: ['baseline record'] } } }, [
		'filter-only',
	]);
	add(
		'where.string.not_in_missing_field',
		{ where: { summary: { not_in: ['unrelated'] } } },
		['filter-only', 'null-handling'],
		{ notes: 'not_in requires the field to be PRESENT — missing/null must fail it.' },
	);
	add('where.string.empty_string_eq', { where: { title: '' } }, [
		'filter-only',
		'shorthand',
	]);
	add(
		'where.string.numeric_string_eq',
		{ where: { code: '5' } },
		['filter-only', 'shorthand'],
		{ notes: "Numeric-string probe: '5' must not coerce to 5 (plan §5 coercion rule)." },
	);
	add(
		'where.string.numeric_number_against_string_field',
		{ where: { code: 5 } },
		['filter-only', 'empty-result'],
		{ notes: "The other half of the probe: 5 must not match the string '5'." },
	);
	add('where.string.gt', { where: { code: { gt: '1' } } }, ['filter-only']);
	add('where.string.gte', { where: { code: { gte: '100' } } }, ['filter-only']);
	add('where.string.lt', { where: { code: { lt: '5' } } }, ['filter-only']);
	add('where.string.lte', { where: { code: { lte: '5' } } }, ['filter-only']);
	add('where.string.between', { where: { code: { between: ['1', '5'] } } }, [
		'filter-only',
	]);
	add('where.string.unicode_diacritic', { where: { 'address.city': 'Zürich' } }, [
		'filter-only',
		'child-path',
		'unicode',
	]);
	add('where.string.unicode_cjk', { where: { 'address.city': '東京' } }, [
		'filter-only',
		'child-path',
		'unicode',
	]);
	add(
		'where.string.astral_eq',
		{ where: { code: '\u{1F600}' } },
		['filter-only', 'unicode'],
		{ notes: 'Astral-plane equality; the ordering counterpart lives in order.*.' },
	);
	add('where.string.child_path_postal_code', { where: { 'address.postal_code': '10' } }, [
		'filter-only',
		'child-path',
	]);

	/* ====================================================================== */
	/* where — number                                                         */
	/* ====================================================================== */

	add('where.number.eq', { where: { view_count: { eq: 5 } } }, ['filter-only']);
	add('where.number.bare', { where: { view_count: 5 } }, ['filter-only', 'shorthand'], {
		notes: 'Plain number normalizes to {eq} (plan §5 normalization).',
	});
	add('where.number.gt', { where: { view_count: { gt: 5 } } }, ['filter-only']);
	add('where.number.gte', { where: { view_count: { gte: 5 } } }, ['filter-only']);
	add('where.number.lt', { where: { view_count: { lt: 5 } } }, ['filter-only']);
	add('where.number.lte', { where: { view_count: { lte: 5 } } }, ['filter-only']);
	add('where.number.between', { where: { view_count: { between: [0, 10] } } }, [
		'filter-only',
	]);
	add(
		'where.number.between_reversed',
		{ where: { view_count: { between: [10, 0] } } },
		['filter-only', 'empty-result'],
		{ notes: 'Reversed bounds: freeze as empty, not as a swapped range.' },
	);
	add(
		'where.number.multiple_ops',
		{ where: { view_count: { gt: 0, lt: 42 } } },
		['filter-only', 'orama-throws'],
		{
			notes:
				'Report §E: Orama throws INVALID_FILTER_OPERATION for two ops in one object.',
		},
	);
	add(
		'where.number.multiple_ops_three',
		{ where: { view_count: { gte: 0, lte: 100, gt: 1 } } },
		['filter-only', 'orama-throws'],
		{ notes: 'Three simultaneous operators — all must AND together.' },
	);
	add('where.number.negative', { where: { view_count: { lt: 0 } } }, ['filter-only']);
	add('where.number.float_eq', { where: { rating: { eq: 1.25 } } }, ['filter-only']);
	add('where.number.negative_float', { where: { rating: { lte: -1 } } }, ['filter-only']);
	add(
		'where.number.null_and_absent',
		{ where: { rating: { gte: -1000 } } },
		['filter-only', 'null-handling'],
		{ notes: 'A positive predicate must exclude both null and absent ratings.' },
	);
	add('where.number.zero_boundary', { where: { rating: { gte: 0, lte: 0 } } }, [
		'filter-only',
	]);

	/* ====================================================================== */
	/* where — boolean                                                        */
	/* ====================================================================== */

	add('where.boolean.bare_true', { where: { is_published: true } }, [
		'filter-only',
		'shorthand',
	]);
	add('where.boolean.bare_false', { where: { is_published: false } }, [
		'filter-only',
		'shorthand',
	]);
	add(
		'where.boolean.eq_true',
		{ where: { is_published: { eq: true } } },
		['filter-only', 'deviation'],
		{
			notes:
				'json_extract returns 0/1 for booleans — the SQL compiler must coerce (plan §5).',
		},
	);
	add(
		'where.boolean.absent_field',
		{ where: { is_published: false } },
		['filter-only', 'null-handling'],
		{ notes: 'edge_bool_absent must NOT match false — absent is not false.' },
	);
	add('where.boolean_array.contains_true', { where: { flags: true } }, [
		'filter-only',
		'array-field',
		'shorthand',
	]);
	add(
		'where.boolean_array.eq_false',
		{ where: { flags: { eq: false } } },
		['filter-only', 'array-field', 'deviation'],
		{
			notes:
				'Report §6: {eq} on an array field is a silent empty set in Orama; ours means "contains".',
		},
	);

	/* ====================================================================== */
	/* where — enum / enum[]                                                  */
	/* ====================================================================== */

	add('where.enum.eq', { where: { status: { eq: 'published' } } }, ['filter-only']);
	add(
		'where.enum.bare',
		{ where: { status: 'published' } },
		['filter-only', 'shorthand', 'orama-throws'],
		{
			notes:
				'Report §E: a bare value on an enum throws in Orama; normalizeWhere papers over it.',
		},
	);
	add('where.enum.in', { where: { status: { in: ['draft', 'archived'] } } }, [
		'filter-only',
	]);
	add('where.enum.bare_array', { where: { status: ['draft', 'archived'] } }, [
		'filter-only',
		'shorthand',
	]);
	add('where.enum.in_empty', { where: { status: { in: [] } } }, [
		'filter-only',
		'empty-result',
	]);
	add('where.enum.not_in', { where: { status: { not_in: ['published'] } } }, [
		'filter-only',
	]);
	add('where.enum.not_in_empty', { where: { status: { not_in: [] } } }, ['filter-only']);
	add('where.enum.numeric_value', { where: { tier: { eq: 3 } } }, ['filter-only']);
	add(
		'where.enum.numeric_value_as_string',
		{ where: { tier: { eq: '3' } } },
		['filter-only', 'empty-result'],
		{ notes: "Numeric enum: '3' must not match 3." },
	);
	add(
		'where.enum_array.contains_all',
		{ where: { label_ids: { contains_all: ['l_red'] } } },
		['filter-only', 'array-field'],
	);
	add(
		'where.enum_array.contains_all_multi',
		{ where: { label_ids: { contains_all: ['l_red', 'l_green'] } } },
		['filter-only', 'array-field'],
	);
	add(
		'where.enum_array.contains_any',
		{ where: { label_ids: { contains_any: ['l_red', 'l_yellow'] } } },
		['filter-only', 'array-field'],
	);
	add(
		'where.enum_array.contains_all_empty_list',
		{ where: { label_ids: { contains_all: [] } } },
		['filter-only', 'array-field'],
		{ notes: 'Vacuously true, or empty? Freeze it here.' },
	);
	add(
		'where.enum_array.eq',
		{ where: { label_ids: { eq: 'l_red' } } },
		['filter-only', 'array-field', 'deviation', 'orama-throws'],
		{ notes: 'Report §6: Orama throws for {eq} on enum[]; ours means "contains".' },
	);
	add(
		'where.enum_array.bare_value',
		{ where: { label_ids: 'l_red' } },
		['filter-only', 'array-field', 'shorthand', 'orama-throws'],
		{ notes: 'Report §6: a bare value on enum[] throws Invalid operation in Orama.' },
	);
	add(
		'where.enum_array.not_in',
		{ where: { label_ids: { not_in: ['l_red'] } } },
		['filter-only', 'array-field', 'null-handling'],
		{
			notes:
				'Present AND no element in the list — an empty array field still counts as present.',
		},
	);
	add(
		'where.enum_array.empty_array_doc',
		{
			where: { label_ids: { contains_any: ['l_red', 'l_green', 'l_blue', 'l_yellow'] } },
		},
		['filter-only', 'array-field', 'null-handling'],
		{
			notes: 'edge_null_rating carries label_ids: [] and must never match contains_any.',
		},
	);

	/* ====================================================================== */
	/* where — string[] / number[]                                            */
	/* ====================================================================== */

	add('where.string_array.bare_value', { where: { tags: 'red' } }, [
		'filter-only',
		'array-field',
		'shorthand',
	]);
	add('where.string_array.bare_array', { where: { tags: ['red', 'green'] } }, [
		'filter-only',
		'array-field',
		'shorthand',
	]);
	add(
		'where.string_array.eq',
		{ where: { tags: { eq: 'red' } } },
		['filter-only', 'array-field', 'deviation'],
		{ notes: 'Report §6: silent empty set in Orama; ours means "contains".' },
	);
	add(
		'where.string_array.in',
		{ where: { tags: { in: ['red', 'blue'] } } },
		['filter-only', 'array-field', 'deviation'],
		{
			notes:
				'Report §6: {in} on string[] is a silent empty set in Orama; ours is contains-any.',
		},
	);
	add(
		'where.string_array.contains_all',
		{ where: { tags: { contains_all: ['red', 'blue'] } } },
		['filter-only', 'array-field', 'deviation'],
		{ notes: 'Report §6: contains_all works only on enum[] in Orama.' },
	);
	add(
		'where.string_array.contains_any',
		{ where: { tags: { contains_any: ['red', 'yellow'] } } },
		['filter-only', 'array-field', 'deviation'],
		{ notes: 'Report §6: contains_any works only on enum[] in Orama.' },
	);
	add('where.string_array.not_in', { where: { tags: { not_in: ['red'] } } }, [
		'filter-only',
		'array-field',
	]);
	add(
		'where.string_array.hyphenated_value',
		{ where: { tags: 'well-known' } },
		['filter-only', 'array-field', 'tokenizer'],
		{ notes: 'Filtering is exact-value, never tokenized — the hyphen must survive.' },
	);
	add('where.number_array.eq', { where: { scores: { eq: 3 } } }, [
		'filter-only',
		'array-field',
	]);
	add('where.number_array.gt', { where: { scores: { gt: 5 } } }, [
		'filter-only',
		'array-field',
	]);
	add('where.number_array.between', { where: { scores: { between: [-3, 0] } } }, [
		'filter-only',
		'array-field',
	]);
	add(
		'where.number_array.empty_array_doc',
		{ where: { scores: { gte: -1000 } } },
		['filter-only', 'array-field', 'null-handling'],
		{ notes: 'An empty number[] must not match any positive element predicate.' },
	);

	/* ====================================================================== */
	/* where — composites                                                     */
	/* ====================================================================== */

	add(
		'where.and.two_leaves',
		{ where: { and: [{ status: { eq: 'published' } }, { view_count: { gte: 5 } }] } },
		['filter-only', 'composite'],
	);
	add(
		'where.or.two_leaves',
		{ where: { or: [{ status: { eq: 'draft' } }, { status: { eq: 'archived' } }] } },
		['filter-only', 'composite'],
	);
	add(
		'where.and.empty',
		{ where: { and: [] } },
		['filter-only', 'composite', 'empty-result'],
		{
			notes: 'Report §7: Orama evaluates both and:[] and or:[] to the empty set.',
		},
	);
	add('where.or.empty', { where: { or: [] } }, [
		'filter-only',
		'composite',
		'empty-result',
	]);
	add(
		'where.not.eq_missing_field_passes',
		{ where: { not: { rating: { eq: 1.25 } } } },
		['filter-only', 'composite', 'null-handling'],
		{ notes: 'Report §7: not complements over the CORPUS, so missing-field docs pass.' },
	);
	add('where.not.enum_eq', { where: { not: { status: { eq: 'published' } } } }, [
		'filter-only',
		'composite',
		'null-handling',
	]);
	add('where.not.boolean', { where: { not: { is_published: true } } }, [
		'filter-only',
		'composite',
		'null-handling',
	]);
	add('where.not.array_contains', { where: { not: { tags: 'red' } } }, [
		'filter-only',
		'composite',
		'array-field',
	]);
	add(
		'where.not.not_in',
		{ where: { not: { status: { not_in: ['published'] } } } },
		['filter-only', 'composite', 'null-handling'],
		{ notes: 'not(not_in) is NOT eq — missing-field docs pass the outer not.' },
	);
	add(
		'where.not.nested_and',
		{
			where: { not: { and: [{ status: { eq: 'draft' } }, { view_count: { gte: 7 } }] } },
		},
		['filter-only', 'composite'],
	);
	add(
		'where.nested.and_or_not',
		{
			where: {
				and: [
					{ or: [{ status: { eq: 'draft' } }, { tier: { eq: 3 } }] },
					{ not: { 'address.country': { eq: 'CH' } } },
				],
			},
		},
		['filter-only', 'composite', 'child-path'],
	);
	add(
		'where.nested.three_levels',
		{
			where: {
				and: [
					{ or: [{ and: [{ view_count: { gte: 0 } }, { view_count: { lte: 10 } }] }] },
					{ not: { or: [{ status: { eq: 'archived' } }] } },
				],
			},
		},
		['filter-only', 'composite'],
	);
	add(
		'where.leaf_and_composite_siblings',
		{ where: { status: { eq: 'published' }, and: [{ view_count: { gte: 5 } }] } },
		['filter-only', 'composite'],
		{ notes: 'A leaf key alongside a composite key in the same object — freeze as AND.' },
	);
	add('where.matches_nothing', { where: { title: 'no document has this title' } }, [
		'filter-only',
		'empty-result',
	]);

	/* ====================================================================== */
	/* where — error surface (§4.10)                                          */
	/* ====================================================================== */

	add('where.error.unknown_field', { where: { nonexistent_field: 'x' } }, ['error'], {
		notes: 'Unknown filter field → DelightError.badRequest.',
	});
	add('where.error.unknown_child_path', { where: { 'address.unknown': 'x' } }, [
		'error',
		'child-path',
	]);
	add(
		'where.error.contains_all_on_scalar',
		{ where: { status: { contains_all: ['published'] } } },
		['error'],
		{ notes: 'Report §6 matrix: contains_all on a scalar field is a 400.' },
	);
	add('where.error.unknown_operator', { where: { view_count: { approximately: 5 } } }, [
		'error',
	]);
	add('where.error.geo_operator_on_number', { where: { view_count: { radius: {} } } }, [
		'error',
		'geo',
	]);

	/* ====================================================================== */
	/* term — prefix / exact / tolerance                                      */
	/* ====================================================================== */

	add('term.prefix.default', { term: 'data' }, ['scored', 'tokenizer'], {
		notes:
			'Prefix expansion: data/database/dataset/datum all match, each contributing (report §4).',
	});
	add('term.prefix.single_char', { term: 'a' }, ['scored', 'tokenizer']);
	add('term.exact.true', { term: 'data', exact: true }, ['scored', 'tokenizer']);
	add(
		'term.exact.case_mixed',
		{ term: 'cat', exact: true },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Report §C: Orama exact is case-SENSITIVE and never matches arrays; ours is neither.',
		},
	);
	add(
		'term.exact.on_array_field',
		{ term: 'red', exact: true, fields: ['tags'] },
		['scored', 'array-field', 'deviation'],
		{ notes: 'Report §C: Orama silently returns nothing for exact on array fields.' },
	);
	add('term.tolerance.one', { term: 'hello', tolerance: 1 }, ['scored', 'tokenizer'], {
		notes: 'hello/hallo at distance 1 must both match, at full weight (report §3).',
	});
	add('term.tolerance.two', { term: 'hellp', tolerance: 2 }, ['scored', 'tokenizer']);
	add('term.tolerance.zero', { term: 'hallo', tolerance: 0 }, ['scored', 'tokenizer']);
	add(
		'term.tolerance.with_exact',
		{ term: 'hello', tolerance: 1, exact: true },
		['scored', 'tokenizer'],
		{ notes: 'Report §3: exact:true suppresses tolerance entirely — never combined.' },
	);
	add(
		'term.tolerance.short_token_boundary',
		{ term: 'ab', tolerance: 2 },
		['scored', 'tokenizer'],
		{ notes: 'Tolerance ≥ token length: everything short is within distance.' },
	);
	add(
		'term.tolerance.long_token',
		{ term: 'x'.repeat(70), tolerance: 1 },
		['scored', 'tokenizer'],
		{
			notes:
				'Query-side truncation to 64 chars must mirror the doc side (plan §4.1 step 5).',
		},
	);

	/* ====================================================================== */
	/* term — threshold                                                       */
	/* ====================================================================== */

	add('term.threshold.default', { term: 'alpha beta' }, ['scored'], {
		notes: 'Absent threshold defaults to 1 → the full union.',
	});
	add('term.threshold.one', { term: 'alpha beta', threshold: 1 }, ['scored']);
	add(
		'term.threshold.zero',
		{ term: 'alpha beta', threshold: 0 },
		['scored', 'deviation'],
		{
			notes:
				'Report §5 quirk 1: Orama requires all tokens within ONE field; ours is per-document, so edge_threshold_split_fields is INCLUDED here and excluded in Orama.',
		},
	);
	add(
		'term.threshold.half',
		{ term: 'alpha beta', threshold: 0.5 },
		['scored', 'deviation'],
		{
			notes:
				'Report §5: the fractional blend inherits the per-document deviation of threshold 0.',
		},
	);
	add(
		'term.threshold.quarter',
		{ term: 'alpha beta', threshold: 0.25 },
		['scored', 'deviation'],
		{
			notes: 'Report §5: ceil(|U \\ A| * t) must still admit at least one partial match.',
		},
	);
	add(
		'term.threshold.zero_token_matches_nothing',
		{ term: 'alpha qqqqqqzz', threshold: 0 },
		['scored', 'empty-result'],
		{ notes: 'One token matching nothing ⇒ empty under both readings (report §5).' },
	);
	add(
		'term.threshold.fraction_with_empty_all_set',
		{ term: 'alpha qqqqqqzz', threshold: 0.5 },
		['scored', 'deviation'],
		{
			notes:
				'Report §5 quirk 3: Orama skips the fraction when A is empty; we always apply it.',
		},
	);
	add(
		'term.threshold.prefix_expansion_quirk',
		{ term: 'al be', threshold: 0 },
		['scored', 'orama-bug'],
		{
			notes:
				'Report §5 quirk 2: in Orama, "al" expanding to two index words spuriously satisfies "all tokens" for edge_threshold_prefix_quirk. We count distinct query tokens.',
		},
	);
	add('term.threshold.three_tokens', { term: 'data query index', threshold: 0 }, [
		'scored',
	]);

	/* ====================================================================== */
	/* term — boost / fields                                                  */
	/* ====================================================================== */

	add('term.boost.title', { term: 'alpha', boost: { title: 3 } }, ['scored']);
	add('term.boost.multiple_fields', { term: 'alpha', boost: { title: 2, body: 0.5 } }, [
		'scored',
	]);
	add('term.boost.zero', { term: 'alpha', boost: { title: 0 } }, ['scored']);
	add('term.fields.single', { term: 'alpha', fields: ['title'] }, ['scored']);
	add('term.fields.subset', { term: 'alpha', fields: ['title', 'summary'] }, ['scored']);
	add('term.fields.star', { term: 'alpha', fields: '*' }, ['scored']);
	add('term.fields.array_field', { term: 'red', fields: ['tags'] }, [
		'scored',
		'array-field',
	]);
	add('term.fields.child_path', { term: 'zurich', fields: ['address.city'] }, [
		'scored',
		'child-path',
		'unicode',
	]);
	add(
		'term.fields.error_enum_field',
		{ term: 'published', fields: ['status'] },
		['error'],
		{
			notes: 'Report §2: naming an enum field in `fields` is a 400, not a silent no-op.',
		},
	);
	add('term.fields.error_unknown_field', { term: 'alpha', fields: ['nope'] }, ['error']);
	add('term.enum_never_matches', { term: 'published' }, ['scored'], {
		notes: 'Report §2: enum values never participate in term matching.',
	});

	/* ====================================================================== */
	/* term — tokenizer edge cases                                            */
	/* ====================================================================== */

	add('term.multi_token.shared_vocabulary', { term: 'search engine database' }, [
		'scored',
	]);
	add('term.repeated_words.tf', { term: 'repeat' }, ['scored', 'deviation'], {
		notes:
			'Report §A: Orama de-duplicates tokens so repetition RAISES the score; we keep duplicates so tf is a real term frequency.',
	});
	add(
		'term.email.full_address',
		{ term: 'jane.doe@showandtour.com' },
		['scored', 'tokenizer'],
		{
			notes:
				'Whole address token + split parts; the union balloons under threshold 1 (plan §4.1).',
		},
	);
	add('term.email.local_part', { term: 'jane' }, ['scored', 'tokenizer']);
	add('term.email.domain_part', { term: 'showandtour' }, ['scored', 'tokenizer']);
	add('term.email.tld_only', { term: 'com' }, ['scored', 'tokenizer'], {
		notes:
			'Every email-bearing doc shares the `com` token — deliberate membership balloon.',
	});
	add('term.email.embedded_in_prose', { term: 'jane@example.com' }, [
		'scored',
		'tokenizer',
	]);
	add('term.email.exact_address', { term: 'jane.doe@showandtour.com', exact: true }, [
		'scored',
		'tokenizer',
	]);
	add(
		'term.punctuation.apostrophe',
		{ term: 'jane’s' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Plan §4.1 (2026-08-12): an intra-word apostrophe FOLDS, so `jane’s` is the single token `janes` — no stray `s`. Orama treats `’` as a separator and matches every `jane*` document.',
		},
	);
	add(
		'term.punctuation.apostrophe_less_query',
		{ term: 'janes' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'The folded token is what is indexed, so the apostrophe-less spelling matches it exactly; Orama indexed `jane` + `s` and finds nothing for `janes`.',
		},
	);
	add(
		'term.punctuation.hyphen',
		{ term: 'well-known' },
		['scored', 'tokenizer', 'deviation'],
		{ notes: 'Report §1: Orama keeps `-`; we split into `well` + `known`.' },
	);
	add(
		'term.punctuation.snake_case',
		{ term: 'snake_case_field' },
		['scored', 'tokenizer', 'deviation'],
		{ notes: 'Report §1: Orama keeps `_`; we split.' },
	);
	add(
		'term.punctuation.snake_case_part',
		{ term: 'snake' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Report §1: `snake` matches only because we split on underscore and Orama does not.',
		},
	);
	add('term.camel_case.whole_token', { term: 'getWidgetInfo' }, ['scored', 'tokenizer'], {
		notes:
			'Plan §4.1 (2026-08-12): a camelCase chunk emits the whole lowercased token as well as its parts, so the literal spelling still matches.',
	});
	add('term.camel_case.part', { term: 'widget' }, ['scored', 'tokenizer', 'deviation'], {
		notes:
			'Plan §4.1 (2026-08-12): camelCase parts are indexed; Orama has no case-boundary rule, so `widget` finds nothing there.',
	});
	add(
		'term.camel_case.acronym_boundary',
		{ term: 'server' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Plan §4.1 (2026-08-12): the `\\p{Lu}\\p{Lu}\\p{Ll}` boundary splits `HTTPServer` into `http` + `server`. `server` is the half Orama cannot reach — its single `httpserver` token only prefix-matches `http`.',
		},
	);
	add(
		'term.format_characters.soft_hyphen',
		{ term: 'microscope' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Plan §4.1 (2026-08-12): `\\p{Cf}` folds to nothing, so a soft-hyphenated word is one token; Orama treats the soft hyphen as a separator.',
		},
	);
	add(
		'term.format_characters.zero_width_joiner',
		{ term: 'telescope' },
		['scored', 'tokenizer', 'deviation'],
		{ notes: 'Plan §4.1 (2026-08-12): same rule, with U+200D inside the word.' },
	);
	add('term.acronym_dots.folded', { term: 'usa' }, ['scored', 'tokenizer', 'deviation'], {
		notes:
			'Plan §4.1 (2026-08-12): `U.S.A.` folds to `usa`; Orama splits it into three single-letter tokens.',
	});
	add(
		'term.acronym_dots.query_spelling',
		{ term: 'U.S.A.' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'The query side folds identically, so the dotted spelling is the same single token.',
		},
	);
	add(
		'term.number_chunk.decimal',
		{ term: '3.14' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Plan §4.1 (2026-08-12): a separator-bearing numeric chunk emits the whole chunk plus its digit runs, so `3.14` is findable as one token.',
		},
	);
	add(
		'term.number_chunk.exact_decimal',
		{ term: '3.14', exact: true },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Plan §4.1 (2026-08-12): only the whole-chunk token makes an exact `3.14` match possible; Orama indexes `3` and `14` only.',
		},
	);
	add(
		'term.number_chunk.grouped_thousands',
		{ term: '1,000' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Same rule with a comma separator; the extra whole-chunk token changes membership against Orama.',
		},
	);
	add(
		'term.punctuation.modifier_apostrophe',
		{ term: 'johnʼs' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'Plan §4.1 (2026-08-12): U+02BC joins the apostrophe fold class, so `johnʼs` is the single token `johns`. Orama treats it as a separator and matches every `john*` document.',
		},
	);
	add(
		'term.punctuation.modifier_apostrophe_less_query',
		{ term: 'johns' },
		['scored', 'tokenizer', 'deviation'],
		{
			notes:
				'The folded token is what is indexed, so the apostrophe-less spelling matches exactly; Orama indexed `john` + `s`.',
		},
	);
	add(
		'term.unicode.diacritic_folded',
		{ term: 'cafe' },
		['scored', 'unicode', 'deviation'],
		{ notes: 'NFKD + mark stripping folds café → cafe; Orama only folds U+00C0–U+017F.' },
	);
	add(
		'term.unicode.diacritic_literal',
		{ term: 'café' },
		['scored', 'unicode', 'deviation'],
		{
			notes:
				'The query side folds identically to the doc side, so café and cafe are one token.',
		},
	);
	add('term.unicode.umlaut', { term: 'zurich' }, ['scored', 'unicode', 'deviation'], {
		notes: 'Report §1: Orama shreds Zürich into `z` + `rich`; ours folds to `zurich`.',
	});
	add('term.unicode.cjk', { term: '東京' }, ['scored', 'unicode', 'deviation'], {
		notes: 'Report §1: Orama indexes no CJK at all.',
	});
	add('term.unicode.cyrillic', { term: 'Москва' }, ['scored', 'unicode', 'deviation'], {
		notes: "Report §1: Cyrillic is destroyed by Orama's splitter; ours indexes it.",
	});
	add('term.unicode.astral', { term: '\u{1F600}' }, ['scored', 'unicode'], {
		notes: 'Emoji are outside \\p{L}\\p{N} — the term tokenizes to nothing.',
	});
	add(
		'term.long_token.over_64_chars',
		{ term: 'x'.repeat(70) },
		['scored', 'tokenizer'],
		{
			notes:
				'edge_long_token and edge_long_token_twin truncate to the SAME 64-char token.',
		},
	);
	add('term.long_token.exactly_64_chars', { term: 'x'.repeat(64) }, [
		'scored',
		'tokenizer',
	]);
	add('term.empty_string', { term: '' }, ['scored', 'empty-result'], {
		notes:
			'An empty term tokenizes to nothing — freeze whether that means "all" or "none".',
	});
	// Frozen: a term that tokenizes to nothing constrains nothing (all docs),
	// consistently with `term: ''` — so NOT `empty-result`.
	add('term.whitespace_only', { term: '   ' }, ['scored', 'deviation'], {
		notes:
			'Frozen answer: whitespace tokenizes to no tokens → no term constraint → full corpus, same as `term: ""`. Orama returns ∅ for a non-empty term that tokenizes to nothing.',
	});
	add('term.matches_nothing', { term: 'qqqqqqzzzzzz' }, ['scored', 'empty-result']);
	add('term.numeric_string', { term: '5' }, ['scored', 'tokenizer']);

	/* ====================================================================== */
	/* facets                                                                 */
	/* ====================================================================== */

	add('facets.string.default', { facets: { 'address.city': {} } }, [
		'filter-only',
		'facets',
		'child-path',
	]);
	add('facets.string.limit', { facets: { 'address.city': { limit: 3 } } }, [
		'filter-only',
		'facets',
	]);
	add(
		'facets.string.limit_offset',
		{ facets: { 'address.city': { limit: 2, offset: 1 } } },
		['filter-only', 'facets'],
	);
	add('facets.string.sort_asc', { facets: { 'address.city': { sort: 'asc' } } }, [
		'filter-only',
		'facets',
	]);
	add('facets.string.sort_desc', { facets: { 'address.city': { sort: 'DESC' } } }, [
		'filter-only',
		'facets',
	]);
	add('facets.enum.default', { facets: { status: {} } }, ['filter-only', 'facets']);
	add('facets.enum_array', { facets: { label_ids: {} } }, [
		'filter-only',
		'facets',
		'array-field',
	]);
	add('facets.string_array', { facets: { tags: {} } }, [
		'filter-only',
		'facets',
		'array-field',
	]);
	add(
		'facets.number.ranges',
		{
			facets: {
				view_count: {
					ranges: [
						{ from: -10, to: 0 },
						{ from: 0, to: 10 },
						{ from: 10, to: 1000 },
					],
				},
			},
		},
		['filter-only', 'facets'],
	);
	add(
		'facets.number.overlapping_ranges',
		{
			facets: {
				rating: {
					ranges: [
						{ from: -5, to: 2 },
						{ from: 0, to: 5 },
					],
				},
			},
		},
		['filter-only', 'facets'],
		{ notes: 'Overlapping ranges: a doc counts in both buckets.' },
	);
	add('facets.boolean.both', { facets: { is_published: { true: true, false: true } } }, [
		'filter-only',
		'facets',
	]);
	add('facets.boolean.true_only', { facets: { is_published: { true: true } } }, [
		'filter-only',
		'facets',
	]);
	add(
		'facets.with_where',
		{ where: { status: { eq: 'published' } }, facets: { 'address.city': {} } },
		['filter-only', 'facets', 'combination'],
		{
			notes: 'Counted over the full matched set, after where, before limit (plan §4.8).',
		},
	);
	add('facets.with_term', { term: 'alpha', facets: { status: {} } }, [
		'scored',
		'facets',
		'combination',
	]);
	add(
		'facets.with_limit_offset_ignored',
		{ facets: { status: {} }, limit: 2, offset: 1 },
		['filter-only', 'facets', 'paging'],
		{ notes: 'Facet counts must ignore limit/offset entirely.' },
	);
	add(
		'facets.multiple_fields',
		{ facets: { status: {}, is_published: { true: true } } },
		['filter-only', 'facets'],
	);
	add(
		'facets.unicode_values',
		{ facets: { 'address.city': { sort: 'asc', limit: 20 } } },
		['filter-only', 'facets', 'unicode'],
	);
	add('facets.error.unknown_field', { facets: { nope: {} } }, ['error', 'facets']);

	/* ====================================================================== */
	/* distinct_on                                                            */
	/* ====================================================================== */

	add(
		'distinct.plain',
		{ distinct_on: 'status', order: [{ field: 'view_count', direction: 'DESC' }] },
		['filter-only', 'distinct'],
	);
	add(
		'distinct.count_semantics',
		{ distinct_on: 'status', order: [{ field: 'id', direction: 'ASC' }] },
		['filter-only', 'distinct', 'deviation'],
		{
			notes: 'Report §D: Orama reports the PRE-distinct count; we freeze post-distinct.',
		},
	);
	add(
		'distinct.with_limit',
		{ distinct_on: 'status', limit: 2, order: [{ field: 'id', direction: 'ASC' }] },
		['filter-only', 'distinct', 'paging'],
	);
	add(
		'distinct.with_offset',
		{
			distinct_on: 'status',
			limit: 2,
			offset: 1,
			order: [{ field: 'id', direction: 'ASC' }],
		},
		['filter-only', 'distinct', 'paging'],
	);
	add(
		'distinct.on_child_path',
		{ distinct_on: 'address.city', order: [{ field: 'id', direction: 'ASC' }] },
		['filter-only', 'distinct', 'child-path'],
	);
	add(
		'distinct.on_number_field',
		{ distinct_on: 'view_count', order: [{ field: 'id', direction: 'ASC' }] },
		['filter-only', 'distinct'],
	);
	add(
		'distinct.on_boolean_field',
		{ distinct_on: 'is_published', order: [{ field: 'id', direction: 'ASC' }] },
		['filter-only', 'distinct', 'null-handling'],
		{
			notes: 'edge_bool_absent has no value — freeze whether absent forms its own group.',
		},
	);
	add('distinct.with_term', { term: 'alpha', distinct_on: 'status' }, [
		'scored',
		'distinct',
		'combination',
	]);
	add('distinct.error.unknown_field', { distinct_on: 'nope' }, ['error', 'distinct']);

	/* ====================================================================== */
	/* order                                                                  */
	/* ====================================================================== */

	add('order.number.asc', { order: [{ field: 'view_count', direction: 'ASC' }] }, [
		'filter-only',
		'order',
		'tie-break',
	]);
	add('order.number.desc', { order: [{ field: 'view_count', direction: 'DESC' }] }, [
		'filter-only',
		'order',
		'tie-break',
	]);
	add(
		'order.default_direction',
		{ order: [{ field: 'view_count' }] },
		['filter-only', 'order'],
		{ notes: 'Direction defaults to ASC.' },
	);
	add(
		'order.string.asc',
		{ order: [{ field: 'title', direction: 'ASC' }] },
		['filter-only', 'order', 'unicode'],
		{
			notes:
				'Code-POINT order, not UTF-16 code-unit order: U+1F600 must sort after U+FFFD (plan §4.6).',
		},
	);
	add('order.string.desc', { order: [{ field: 'title', direction: 'DESC' }] }, [
		'filter-only',
		'order',
		'unicode',
	]);
	add(
		'order.string.code_field_astral',
		{ order: [{ field: 'code', direction: 'ASC' }] },
		['filter-only', 'order', 'unicode'],
	);
	add('order.child_path', { order: [{ field: 'address.city', direction: 'ASC' }] }, [
		'filter-only',
		'order',
		'child-path',
		'unicode',
	]);
	add(
		'order.nulls_last_asc',
		{ order: [{ field: 'rating', direction: 'ASC' }] },
		['filter-only', 'order', 'null-handling'],
		{ notes: 'null AND absent sort LAST regardless of direction (plan §4.6).' },
	);
	add('order.nulls_last_desc', { order: [{ field: 'rating', direction: 'DESC' }] }, [
		'filter-only',
		'order',
		'null-handling',
	]);
	add(
		'order.boolean',
		{ order: [{ field: 'is_published', direction: 'ASC' }] },
		['filter-only', 'order', 'null-handling'],
		{ notes: 'false < true; absent last.' },
	);
	add(
		'order.equal_values_pk_tiebreak',
		{ where: { updated_at: { eq: TIED_UPDATED_AT } }, order: [{ field: 'updated_at' }] },
		['filter-only', 'order', 'tie-break'],
		{ notes: "String PK: '10' sorts before '2'." },
	);
	add(
		'order.equal_updated_at_desc',
		{ order: [{ field: 'updated_at', direction: 'DESC' }] },
		['filter-only', 'order', 'tie-break'],
		{
			notes:
				'The dominant real-world path — DEFAULT_SEARCH_QUERY orders updated_at DESC.',
		},
	);
	add(
		'order.multi_key',
		{
			order: [
				{ field: 'status', direction: 'ASC' },
				{ field: 'view_count', direction: 'DESC' },
			],
		},
		['filter-only', 'order', 'tie-break'],
	);
	add(
		'order.multi_key_three',
		{
			order: [
				{ field: 'is_published', direction: 'DESC' },
				{ field: 'view_count', direction: 'ASC' },
				{ field: 'title', direction: 'ASC' },
			],
		},
		['filter-only', 'order', 'tie-break'],
	);
	add(
		'order.with_term_overrides_score',
		{ term: 'alpha', order: [{ field: 'view_count', direction: 'ASC' }] },
		['scored', 'order'],
		{ notes: 'order[] wins over BM25 ordering when present (plan §4.6).' },
	);
	add('order.error.unknown_field', { order: [{ field: 'nope' }] }, ['error', 'order']);
	add(
		'order.integer_pk_tiebreak',
		{
			where: { updated_at: { eq: TIED_UPDATED_AT } },
			order: [{ field: 'capacity', direction: 'ASC' }],
		},
		['filter-only', 'order', 'tie-break', 'integer-pk'],
		{
			corpus: 'event',
			notes: 'Integer PK: events 1, 2 and 10 tie on every sort key — 2 must precede 10.',
		},
	);

	/* ====================================================================== */
	/* paging                                                                 */
	/* ====================================================================== */

	add('paging.limit_only', { limit: 5, order: [{ field: 'id', direction: 'ASC' }] }, [
		'filter-only',
		'paging',
	]);
	add('paging.limit_one', { limit: 1, order: [{ field: 'id', direction: 'ASC' }] }, [
		'filter-only',
		'paging',
	]);
	add('paging.offset_only', { offset: 5, order: [{ field: 'id', direction: 'ASC' }] }, [
		'filter-only',
		'paging',
	]);
	for (let page = 0; page < 3; page++) {
		add(
			`paging.walk.page_${page}`,
			{ limit: 4, offset: page * 4, order: [{ field: 'id', direction: 'ASC' }] },
			['filter-only', 'paging'],
			{ notes: 'Three consecutive pages must partition the ordered result set.' },
		);
	}
	add(
		'paging.offset_beyond_end',
		{ limit: 5, offset: 100000, order: [{ field: 'id', direction: 'ASC' }] },
		['filter-only', 'paging', 'empty-result'],
	);
	add(
		'paging.limit_zero',
		{ limit: 0, order: [{ field: 'id', direction: 'ASC' }] },
		['filter-only', 'paging'],
		{ notes: 'The server clamps limit to 1..5000 (plan §4.7) — freeze what 0 does.' },
	);
	add(
		'paging.with_term_and_order',
		{
			term: 'alpha',
			limit: 3,
			offset: 2,
			order: [{ field: 'view_count', direction: 'DESC' }],
		},
		['scored', 'paging', 'combination'],
	);
	add(
		'paging.integer_pk_walk',
		{ limit: 4, offset: 4, order: [{ field: 'updated_at', direction: 'DESC' }] },
		['filter-only', 'paging', 'integer-pk', 'tie-break'],
		{ corpus: 'event' },
	);

	/* ====================================================================== */
	/* geo — radius                                                           */
	/* ====================================================================== */

	add(
		'geo.radius.boundary_inclusive',
		{
			where: {
				location: { radius: { coordinates: GEO_CENTER, value: GEO_BOUNDARY_RADIUS_M } },
			},
		},
		['filter-only', 'geo', 'geo-radius'],
		{
			notes:
				'edge_geo_boundary_exact sits EXACTLY on this radius; inside:true is `distance <= value` (report §8).',
		},
	);
	add(
		'geo.radius.boundary_exclusive',
		{
			where: {
				location: {
					radius: {
						coordinates: GEO_CENTER,
						value: GEO_BOUNDARY_RADIUS_M,
						inside: false,
					},
				},
			},
		},
		['filter-only', 'geo', 'geo-radius'],
		{
			notes:
				'inside:false is `distance > value` — the exact complement over INDEXED points.',
		},
	);
	for (const [unit, metres] of Object.entries(GEO_UNIT_METRES)) {
		add(
			`geo.radius.unit.${unit}`,
			{
				where: {
					location: {
						radius: {
							coordinates: GEO_CENTER,
							value: GEO_BOUNDARY_RADIUS_M / metres,
							unit,
						},
					},
				},
			},
			['filter-only', 'geo', 'geo-radius'],
			{ notes: 'Every unit expresses the same boundary distance — all six must agree.' },
		);
	}
	add(
		'geo.radius.default_unit_is_metres',
		{ where: { location: { radius: { coordinates: GEO_CENTER, value: 1000 } } } },
		['filter-only', 'geo', 'geo-radius'],
	);
	add(
		'geo.radius.zero',
		{ where: { location: { radius: { coordinates: GEO_CENTER, value: 0 } } } },
		['filter-only', 'geo', 'geo-radius'],
		{ notes: 'Only docs exactly at the centre (distance 0 <= 0).' },
	);
	add(
		'geo.radius.huge',
		{
			where: {
				location: { radius: { coordinates: GEO_CENTER, value: 20000, unit: 'km' } },
			},
		},
		['filter-only', 'geo', 'geo-radius', 'null-handling'],
		{ notes: 'Half the planet — but missing/null geopoints still must not match.' },
	);
	add(
		'geo.radius.missing_geopoint_excluded',
		{
			where: {
				location: { radius: { coordinates: GEO_CENTER, value: 100, unit: 'km' } },
			},
		},
		['filter-only', 'geo', 'geo-radius', 'null-handling'],
		{ notes: 'Report §10: edge_geo_missing and edge_geo_null fail BOTH directions.' },
	);
	add(
		'geo.radius.not_composite_admits_missing',
		{
			where: {
				not: {
					location: { radius: { coordinates: GEO_CENTER, value: 100, unit: 'km' } },
				},
			},
		},
		['filter-only', 'geo', 'geo-radius', 'composite', 'null-handling'],
		{
			notes:
				'Report §10 contrast: `not` complements over the CORPUS, so missing-geo docs pass.',
		},
	);
	add(
		'geo.radius.high_precision_ignored',
		{
			where: {
				location: {
					radius: {
						coordinates: GEO_CENTER,
						value: GEO_BOUNDARY_RADIUS_M,
						highPrecision: true,
					},
				},
			},
		},
		['filter-only', 'geo', 'geo-radius'],
		{
			notes:
				'highPrecision is accepted and ignored — we are always haversine (report §8).',
		},
	);
	add(
		'geo.radius.error_unknown_unit',
		{
			where: { location: { radius: { coordinates: GEO_CENTER, value: 1, unit: 'nm' } } },
		},
		['error', 'geo', 'geo-radius'],
		{ notes: 'Report §8: an unrecognized unit throws.' },
	);
	add(
		'geo.radius.with_where',
		{
			where: {
				and: [
					{ location: { radius: { coordinates: GEO_CENTER, value: 50, unit: 'km' } } },
					{ status: { eq: 'published' } },
				],
			},
		},
		['filter-only', 'geo', 'geo-radius', 'combination'],
	);
	add(
		'geo.radius.integer_pk_corpus',
		{ where: { place: { radius: { coordinates: GEO_CENTER, value: 5, unit: 'km' } } } },
		['filter-only', 'geo', 'geo-radius', 'integer-pk'],
		{ corpus: 'event' },
	);

	/* ====================================================================== */
	/* geo — polygon                                                          */
	/* ====================================================================== */

	add(
		'geo.polygon.inside',
		{
			where: { location: { polygon: { coordinates: polygonCoordinates(POLYGON_BOX) } } },
		},
		['filter-only', 'geo', 'geo-polygon'],
		{
			notes:
				'Report §9 half-open boundary: bottom edge, left edge and the bottom-left vertex are INSIDE; top/right edges and the top-right vertex are OUTSIDE.',
		},
	);
	add(
		'geo.polygon.outside',
		{
			where: {
				location: {
					polygon: { coordinates: polygonCoordinates(POLYGON_BOX), inside: false },
				},
			},
		},
		['filter-only', 'geo', 'geo-polygon', 'null-handling'],
		{
			notes:
				'Exact complement over INDEXED points — missing/null geopoints still excluded.',
		},
	);
	add(
		'geo.polygon.explicit_closing_vertex',
		{
			where: {
				location: {
					polygon: {
						coordinates: [...polygonCoordinates(POLYGON_BOX), { lat: 47, lon: 8 }],
					},
				},
			},
		},
		['filter-only', 'geo', 'geo-polygon'],
		{
			notes:
				'The ring is implicitly closed — repeating the first vertex must change nothing.',
		},
	);
	add(
		'geo.polygon.triangle',
		{
			where: {
				location: {
					polygon: {
						coordinates: [
							{ lat: 47, lon: 8 },
							{ lat: 48, lon: 8 },
							{ lat: 47.5, lon: 9 },
						],
					},
				},
			},
		},
		['filter-only', 'geo', 'geo-polygon'],
	);
	add(
		'geo.polygon.degenerate_two_points',
		{
			where: {
				location: {
					polygon: {
						coordinates: [
							{ lat: 47, lon: 8 },
							{ lat: 48, lon: 9 },
						],
					},
				},
			},
		},
		['filter-only', 'geo', 'geo-polygon', 'empty-result'],
		{
			notes:
				'A degenerate ring encloses nothing — freeze it as empty rather than an error.',
		},
	);
	add(
		'geo.polygon.antimeridian',
		{
			where: {
				location: { polygon: { coordinates: polygonCoordinates(ANTIMERIDIAN_POLYGON) } },
			},
		},
		['filter-only', 'geo', 'geo-polygon', 'defined-behavior-only'],
		{
			notes:
				'Report §9: planar math spans the LONG way, so edge_anti_zero matches and edge_anti_east does not. Assert the defined planar result, never a geographic one.',
		},
	);
	add(
		'geo.polygon.with_term',
		{
			term: 'baseline',
			where: { location: { polygon: { coordinates: polygonCoordinates(POLYGON_BOX) } } },
		},
		['scored', 'geo', 'geo-polygon', 'combination'],
	);
	add(
		'geo.polygon.integer_pk_corpus',
		{ where: { place: { polygon: { coordinates: polygonCoordinates(POLYGON_BOX) } } } },
		['filter-only', 'geo', 'geo-polygon', 'integer-pk'],
		{ corpus: 'event' },
	);

	/* ====================================================================== */
	/* vector + hybrid (server-only)                                          */
	/* ====================================================================== */

	add(
		'vector.default_similarity',
		{ vector: { value: VECTOR_QUERY, field: 'embedding' } },
		['vector', 'server-only'],
		{
			notes:
				'Report §11: similarity defaults to 0.8, so cosine 0.79 drops out and 0.80 stays.',
		},
	);
	add(
		'vector.similarity_080',
		{ vector: { value: VECTOR_QUERY, field: 'embedding', similarity: 0.8 } },
		['vector', 'server-only'],
		{ notes: 'The boundary doc has cosine exactly 0.8 — admitted (`>= similarity`).' },
	);
	add(
		'vector.similarity_079',
		{ vector: { value: VECTOR_QUERY, field: 'embedding', similarity: 0.79 } },
		['vector', 'server-only'],
	);
	add(
		'vector.similarity_085',
		{ vector: { value: VECTOR_QUERY, field: 'embedding', similarity: 0.85 } },
		['vector', 'server-only'],
	);
	add(
		'vector.similarity_zero',
		{ vector: { value: VECTOR_QUERY, field: 'embedding', similarity: 0 } },
		['vector', 'server-only', 'null-handling'],
		{ notes: 'Even at 0, docs with no vector (edge_vec_missing) must not appear.' },
	);
	add(
		'vector.non_unit_query',
		{ vector: { value: [2, 0, 0, 0, 0, 0, 0, 0], field: 'embedding' } },
		['vector', 'server-only'],
		{
			notes:
				'Query vectors normalize at query time — scaling must not change the ranking.',
		},
	);
	add(
		'vector.non_unit_document',
		{ vector: { value: VECTOR_QUERY, field: 'embedding', similarity: 0.99 } },
		['vector', 'server-only'],
		{
			notes:
				'edge_vec_non_unit is [3,0,...] and must score 1.0 after write-time normalization.',
		},
	);
	add(
		'vector.with_where',
		{
			vector: { value: VECTOR_QUERY, field: 'embedding' },
			where: { status: { eq: 'published' } },
		},
		['vector', 'server-only', 'combination'],
	);
	add(
		'vector.with_limit',
		{ vector: { value: VECTOR_QUERY, field: 'embedding' }, limit: 3 },
		['vector', 'server-only', 'paging'],
	);
	add('vector.error.unknown_field', { vector: { value: VECTOR_QUERY, field: 'nope' } }, [
		'error',
		'vector',
		'server-only',
	]);
	add(
		'vector.error.non_vector_field',
		{ vector: { value: VECTOR_QUERY, field: 'title' } },
		['error', 'vector', 'server-only'],
	);
	add(
		'vector.error.dimension_mismatch',
		{ vector: { value: [1, 0, 0], field: 'embedding' } },
		['error', 'vector', 'server-only'],
	);
	add(
		'vector.error.zero_query_vector',
		{ vector: { value: [0, 0, 0, 0, 0, 0, 0, 0], field: 'embedding' } },
		['error', 'vector', 'server-only'],
		{ notes: 'Plan §4.9: zero vectors are rejected — cosine is undefined for them.' },
	);
	add(
		'vector.integer_pk_corpus',
		{ vector: { value: VECTOR_QUERY, field: 'embedding' } },
		['vector', 'server-only', 'integer-pk', 'tie-break'],
		{ corpus: 'event' },
	);
	add(
		'hybrid.term_and_vector',
		{ term: 'alpha', vector: { value: VECTOR_QUERY, field: 'embedding' } },
		['hybrid', 'vector', 'scored', 'server-only'],
		{
			notes:
				'Report §12: max-normalize each set, then 0.5 * text + 0.5 * vector, then PK-ascending tie-break.',
		},
	);
	add(
		'hybrid.with_similarity_floor',
		{
			term: 'alpha',
			vector: { value: VECTOR_QUERY, field: 'embedding', similarity: 0.9 },
		},
		['hybrid', 'vector', 'scored', 'server-only'],
		{
			notes: 'Report §11: the floor applies inside hybrid — filtered docs contribute 0.',
		},
	);
	add(
		'hybrid.with_where_and_order',
		{
			term: 'alpha',
			vector: { value: VECTOR_QUERY, field: 'embedding' },
			where: { status: { eq: 'published' } },
			order: [{ field: 'view_count', direction: 'DESC' }],
		},
		['hybrid', 'vector', 'scored', 'server-only', 'combination'],
	);
	add(
		'hybrid.term_matches_nothing',
		{ term: 'qqqqqqzzzzzz', vector: { value: VECTOR_QUERY, field: 'embedding' } },
		['hybrid', 'vector', 'scored', 'server-only'],
		{
			notes:
				'Report §12: an empty/zero-max score set must be guarded, not produce NaN/-0.',
		},
	);

	/* ====================================================================== */
	/* combinations                                                           */
	/* ====================================================================== */

	add(
		'combination.where_term_order_facets_limit',
		{
			term: 'search engine',
			where: {
				and: [{ status: { in: ['published', 'draft'] } }, { view_count: { gte: 0 } }],
			},
			order: [
				{ field: 'view_count', direction: 'DESC' },
				{ field: 'updated_at', direction: 'ASC' },
			],
			facets: { status: {}, 'address.city': { limit: 3, sort: 'desc' } },
			limit: 5,
			offset: 1,
			boost: { title: 2 },
			tolerance: 1,
		},
		['scored', 'facets', 'order', 'paging', 'combination'],
	);
	add(
		'combination.geo_term_distinct',
		{
			term: 'baseline',
			where: { location: { radius: { coordinates: GEO_CENTER, value: 60, unit: 'km' } } },
			distinct_on: 'status',
			limit: 3,
		},
		['scored', 'geo', 'geo-radius', 'distinct', 'combination'],
	);
	add(
		'combination.sparse_false',
		{ where: { status: { eq: 'published' } }, sparse: false, limit: 3 },
		['filter-only', 'combination'],
		{
			notes:
				'sparse:false hydrates the full row — membership and order must be unchanged.',
		},
	);
	add(
		'combination.integer_pk_full_query',
		{
			term: 'alpha',
			where: {
				and: [{ kind: { in: ['meetup', 'webinar'] } }, { capacity: { gte: 10 } }],
			},
			order: [{ field: 'capacity', direction: 'ASC' }],
			facets: { kind: {}, is_virtual: { true: true, false: true } },
			limit: 5,
		},
		['scored', 'facets', 'order', 'integer-pk', 'combination'],
		{ corpus: 'event' },
	);
	add(
		'combination.event_child_path_filter',
		{
			where: { 'venue.region': { in: ['emea', 'apac'] } },
			order: [{ field: 'venue.city' }],
		},
		['filter-only', 'child-path', 'order', 'integer-pk', 'unicode'],
		{ corpus: 'event' },
	);
	add(
		'combination.event_array_filters',
		{
			where: {
				and: [{ seat_labels: { contains_any: ['a1', 'b1'] } }, { attendee_emails: 'x' }],
			},
		},
		['filter-only', 'array-field', 'integer-pk', 'empty-result'],
		{ corpus: 'event' },
	);
	add(
		'combination.event_email_term',
		{ term: 'ada@delight.co' },
		['scored', 'tokenizer', 'integer-pk'],
		{ corpus: 'event' },
	);
	add(
		'combination.event_nulls_order',
		{ order: [{ field: 'price', direction: 'ASC' }] },
		['filter-only', 'order', 'null-handling', 'integer-pk'],
		{ corpus: 'event' },
	);

	return cases;
}

/** The battery. Order is stable — golden fixtures may key off the index. */
export const SEARCH_BATTERY: BatteryCase[] = buildBattery();

/** Every tag actually used by the battery, sorted. */
export const BATTERY_TAGS: BatteryTag[] = Array.from(
	new Set(SEARCH_BATTERY.flatMap((battery_case) => battery_case.tags)),
).sort() as BatteryTag[];

/** Cases carrying a given tag, in battery order. */
export function batteryCasesByTag(tag: BatteryTag): BatteryCase[] {
	return SEARCH_BATTERY.filter((battery_case) => battery_case.tags.includes(tag));
}

/** Cases written against a given corpus preset, in battery order. */
export function batteryCasesForCorpus(preset: CorpusPresetName): BatteryCase[] {
	return SEARCH_BATTERY.filter((battery_case) => battery_case.corpus === preset);
}

/**
 * Cases whose results may be compared against Orama.
 *
 * Excludes everything the Orama verification report proved is broken or that we
 * deliberately changed, plus the server-only vector/hybrid paths and the cases
 * that must throw.
 */
export function batteryCasesWithOramaParity(): BatteryCase[] {
	const excluded: BatteryTag[] = [
		'deviation',
		'orama-bug',
		'orama-throws',
		'error',
		'server-only',
	];
	return SEARCH_BATTERY.filter(
		(battery_case) => !battery_case.tags.some((tag) => excluded.includes(tag)),
	);
}
