/**
 * The differential harness — plan §8.1, the Phase 2 gate.
 *
 * **Test-only, and temporary.** It runs the query battery through real Orama
 * 3.1.16 and through the memory reference engine and asserts they agree
 * everywhere the frozen spec says they must. It retires with `@orama/orama` in
 * Phase 5; the golden vectors (§8.2) are the permanent guard.
 *
 * ## Assertion tiers
 *
 * | Tier | Cases | Assertion |
 * |---|---|---|
 * | filter | `filter-only`, no `distinct_on` | exact membership set **and** `count` |
 * | scored | `scored` | exact membership set **and** `count` (see below) |
 * | distinct | any `distinct_on` case | number of distinct groups |
 * | facets | any case requesting facets | per-value counts |
 *
 * Three things Orama simply cannot express, so they are never compared:
 *
 * - **Result order.** Orama has no multi-key `order`; its `sortBy` takes one
 *   property and has no tie-break, so every comparison here is run with
 *   `limit`/`offset` stripped and membership compared as a set. Ordering and
 *   paging are frozen by the golden vectors instead.
 * - **Integer primary keys.** Orama throws on a numeric document id, so the
 *   `event` corpus is handed to it stringified (`orama_reference.ts`).
 * - **Rank order, and top-N membership with it.** Report finding B lists four
 *   deliberate scoring deviations (token de-duplication making Orama's `tf`
 *   meaningless, `d` inside the BM25 numerator, `N` counted globally rather
 *   than per field, and a global `avgFieldLength`). Measured over the 1000-doc
 *   corpus, top-10 *membership* agreement across the scored battery ranges
 *   from 0/10 to 8/10 — so top-N membership is unachievable too, not just
 *   rank order. What *is* achievable, and what this harness asserts, is the
 *   full matched **set** and its `count`: membership is decided by token
 *   matching and `threshold`, not by score.
 *
 * `ORAMA_DIVERGENCES` below lists every remaining case where the two engines
 * legitimately disagree, with the reason. Each entry is *asserted to actually
 * diverge* on the 1000-doc corpus, so the table cannot rot into a silent
 * exclusion list.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { DelightError } from '@delightstack/utilities';
import {
	batteryCasesWithOramaParity,
	SEARCH_BATTERY,
	type BatteryCase,
	type FixtureSearchQuery,
} from './fixtures/battery';
import type { CorpusPresetName, CorpusSizeName } from './fixtures/corpus';
import { createOramaReference, tryOrama, type OramaReference } from './orama_reference';
import { loadCorpus, toEngineQuery, type LoadedCorpus } from './support';

/**
 * `large` (20k docs) is deliberately off: it adds minutes for no new
 * information — every divergence below is already visible at 1000 documents.
 * Opt in with `DELIGHT_SEARCH_DIFF_LARGE=1` when changing tokenizer or scoring.
 */
const INCLUDE_LARGE =
	typeof process !== 'undefined' && process.env?.DELIGHT_SEARCH_DIFF_LARGE === '1';

const SIZES: CorpusSizeName[] = INCLUDE_LARGE
	? ['tiny', 'small', 'large']
	: ['tiny', 'small'];

/** The size the divergence table is pinned against — small enough to be fast,
 * big enough that every documented divergence is observable. */
const DIVERGENCE_SIZE: CorpusSizeName = 'small';

/* -------------------------------------------------------------------------- */
/* Documented divergences                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parity-tagged battery cases where the native engine and Orama legitimately
 * disagree, with the reason. `report §N` cites
 * `plans/database/orama-verification-report.md`; **NEW** marks a behavior that
 * report did not record and this harness discovered.
 */
const ORAMA_DIVERGENCES: Record<string, string> = {
	/* --- scalar `string` filtering is not equality in Orama ---------------- */
	// NEW (extends report §6 / finding E, which only covered `{eq}`): a scalar
	// `string` field is backed by a Radix tree, whose filter branch fires only
	// for a BARE string or array — and then *tokenizes* the operand and unions
	// the postings. So a bare value is a tokenized contains, never equality, and
	// EVERY operator object (`eq`, `not_in`, `gt`, `gte`, `lt`, `lte`,
	// `between`) silently yields the empty set. Ours is strict typed equality
	// and core-comparator ordering, per plan §5.
	'where.string.bare':
		'NEW: Orama tokenizes a bare string operand and unions; ours is equality.',
	'where.string.bare_array':
		'NEW: Orama tokenizes each element of a bare array operand; ours is `in`.',
	'where.string.empty_string_eq':
		"NEW: an empty string tokenizes to nothing in Orama, so it matches nothing; ours matches `''`.",
	'where.string.not_in':
		'report §6 (extended): operator objects on scalar `string` return ∅ in Orama.',
	'where.string.not_in_missing_field':
		'report §6 (extended): operator objects on scalar `string` return ∅ in Orama.',
	'where.string.gt':
		'report §6 (extended): no ordering operators exist on Orama Radix fields.',
	'where.string.gte':
		'report §6 (extended): no ordering operators exist on Orama Radix fields.',
	'where.string.lt':
		'report §6 (extended): no ordering operators exist on Orama Radix fields.',
	'where.string.lte':
		'report §6 (extended): no ordering operators exist on Orama Radix fields.',
	'where.string.between':
		'report §6 (extended): no ordering operators exist on Orama Radix fields.',
	'where.string.unicode_cjk':
		'NEW + report §1: `東京` tokenizes to nothing in Orama, so a bare CJK operand matches nothing.',
	'where.string.astral_eq':
		'NEW + report §1: an emoji tokenizes to nothing in Orama, so a bare astral operand matches nothing.',
	'where.matches_nothing':
		'NEW: the impossible value is a scalar-string filter, which Orama evaluates by tokenized union.',
	'where.leaf_and_composite_siblings':
		'NEW: the leaf half is a scalar-string filter (tokenized union in Orama).',

	/* --- operand-shape errors Orama raises and we accept ------------------- */
	// NEW (adjacent to report finding E): a bare number reaches the AVL branch
	// with no operator object and dereferences `undefined.toString()`.
	'where.number.bare':
		'NEW: a bare number THROWS in Orama; plan §5 normalizes it to `{eq}`.',
	'where.number.zero_boundary':
		'report finding E: two operators in one object throw `INVALID_FILTER_OPERATION`; ours AND-compose.',
	'where.enum.bare_array':
		'report finding E: a bare array on an enum throws (Orama reads `Object.keys` of the operand).',

	/* --- array-field matrix (report §6) ------------------------------------ */
	'where.enum_array.not_in':
		'report §6: `enum[]` supports only containsAll/containsAny; else it throws.',
	'where.string_array.not_in':
		'report §6: unsupported operators on `string[]` return a silent ∅.',
	'where.enum_array.contains_all_empty_list':
		'FROZEN ANSWER: `contains_all: []` is vacuously true for any doc whose field is a present array (missing/null still fails). Orama returns ∅.',

	/* --- tokenizer (report §1) --------------------------------------------- */
	'term.prefix.single_char':
		'report §1: `_` is a word character in Orama, so ids like `edge_astral_high` are one token there and three here.',
	'term.numeric_string':
		'report §1: `-` is a word character in Orama, so `jane-doe-501` stays one token there.',
	'term.fields.child_path':
		'report §1: `Zürich` tokenizes to `z`/`rich` in Orama — `ü` is a separator.',
	'term.unicode.astral':
		'FROZEN ANSWER: a term that tokenizes to nothing is no term constraint at all → every document, consistently with `term: ""`. Orama returns ∅ for a non-empty term but everything for `""`.',
	'term.whitespace_only':
		'FROZEN ANSWER: same rule — whitespace tokenizes to nothing, so it constrains nothing.',
	'term.long_token.over_64_chars':
		'report §1: the 64-character cap is ours; Orama indexes the full token, so the two fixture docs sharing 64 characters collide for us and not for it.',
	'term.tolerance.long_token': 'report §1: as above, on the query side.',
	'term.tolerance.two':
		'report §1 + §3: the candidate dictionaries differ, so bounded-Levenshtein expansion admits different tokens.',
	'term.tolerance.short_token_boundary':
		'report §1 + §3: as above, at tolerance ≥ token length.',
	'term.email.exact_address':
		'report finding C: Orama `exact` is a case-sensitive regex over the raw string value; ours is whole-token equality.',

	/* --- threshold + boost -------------------------------------------------- */
	'term.threshold.three_tokens':
		'report §5: Orama requires all tokens within a SINGLE property and lets prefix expansion count twice; ours is per-document over distinct query tokens.',
	'term.boost.zero':
		'NEW: Orama rejects `boost: 0` ("Boost value must be a number greater than, or less than 0"); ours treats 0 as a legitimate zero multiplier.',

	/* --- facets ------------------------------------------------------------- */
	// NEW: `getFacets` (components/facets.ts) does `for (const v of facetValue)`
	// for an array-typed facet property without checking that the document has
	// one — so a single document missing `tags` / `label_ids` crashes the whole
	// search with `TypeError: facetValue is not iterable`. Only visible once the
	// corpus contains such a document (the 1000-doc preset does; the 10-doc one
	// does not). Ours counts array facets over the documents that have them.
	'facets.enum_array':
		'NEW: Orama THROWS on an `enum[]` facet when any document lacks the field.',
	'facets.string_array':
		'NEW: Orama THROWS on a `string[]` facet when any document lacks the field.',

	/* --- distinct ----------------------------------------------------------- */
	'distinct.on_boolean_field':
		'report §7 null rule: a document missing the field forms its own group for us; Orama omits it from the distinct index entirely.',
};

/**
 * `deviation` / `orama-bug` cases whose divergence is NOT observable as a
 * membership difference — either the deviation is in *scoring* only, or this
 * corpus happens not to contain a document that separates the two rules.
 * Everything else must observably diverge.
 */
const DEVIATIONS_WITHOUT_MEMBERSHIP_DIFFERENCE = new Set([
	// `{eq: true}` on a scalar boolean happens to work in Orama.
	'where.boolean.eq_true',
	// Report finding A is a *scoring* deviation (Orama's `tf` is always 1);
	// membership is identical.
	'term.repeated_words.tf',
	// `-` and `_` deviations need a document where the split changes membership;
	// these two probe terms match the same set either way.
	'term.punctuation.hyphen',
	'term.punctuation.snake_case_part',
	// Orama folds `é` (it is one of its six allowed accented vowels), so these
	// agree by luck; `ü`/CJK/Cyrillic (below) are where it breaks.
	'term.unicode.diacritic_folded',
	'term.unicode.diacritic_literal',
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The engine's answer, reduced to what is comparable against Orama. */
interface EngineResult {
	ids: string[];
	count: number;
	facets?: Record<string, { count: number; values: Record<string, number> }>;
}

/**
 * Membership is compared unpaged: `limit`/`offset` slice an *ordered* list, and
 * Orama's order is not ours (see the module docblock).
 */
function unpaged(query: FixtureSearchQuery): FixtureSearchQuery {
	return { ...query, limit: undefined, offset: undefined };
}

function runEngine(loaded: LoadedCorpus, query: FixtureSearchQuery): EngineResult {
	const result = loaded.engine.search(toEngineQuery(query));
	return {
		ids: result.hits.map((hit) => String(hit.id)),
		count: result.count,
		...(result.facets ? { facets: result.facets } : {}),
	};
}

function sortedIds(ids: readonly string[]): string[] {
	return [...ids].sort();
}

/** Whether a facet result holds only the two boolean buckets. */
function isBooleanFacet(values: Record<string, number>): boolean {
	return Object.keys(values).every((key) => key === 'true' || key === 'false');
}

/** Whether a facet definition windows its values (so tie order decides the slice). */
function isWindowedFacet(definition: unknown): boolean {
	if (!definition || typeof definition !== 'object') return false;
	const facet = definition as { limit?: number; offset?: number };
	return facet.limit !== undefined || facet.offset !== undefined;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

describe.each(SIZES)('differential harness vs Orama 3.1.16 (%s corpus)', (size) => {
	const loaded = {} as Record<CorpusPresetName, LoadedCorpus>;
	const orama = {} as Record<CorpusPresetName, OramaReference>;

	beforeAll(() => {
		for (const preset of ['article', 'event'] as CorpusPresetName[]) {
			loaded[preset] = loadCorpus(preset, size);
			orama[preset] = createOramaReference(loaded[preset].corpus);
		}
	}, 120_000);

	/** Parity cases minus the documented divergences. */
	function comparableCases(): BatteryCase[] {
		return batteryCasesWithOramaParity().filter(
			(battery_case) => !(battery_case.name in ORAMA_DIVERGENCES),
		);
	}

	it('agrees on membership and count for filter-only cases', { timeout: 120_000 }, () => {
		const failures: string[] = [];
		let compared = 0;
		for (const battery_case of comparableCases()) {
			if (!battery_case.tags.includes('filter-only')) continue;
			if (battery_case.query.distinct_on !== undefined) continue;
			const query = unpaged(battery_case.query);
			const ours = runEngine(loaded[battery_case.corpus], query);
			const theirs = orama[battery_case.corpus].search(query);
			compared++;
			if (sortedIds(ours.ids).join(',') !== sortedIds(theirs.ids).join(',')) {
				failures.push(
					`${battery_case.name}: membership (ours ${ours.ids.length}, orama ${theirs.ids.length})`,
				);
			} else if (ours.count !== theirs.count) {
				failures.push(`${battery_case.name}: count ${ours.count} vs ${theirs.count}`);
			}
		}
		expect(failures).toEqual([]);
		expect(compared).toBeGreaterThan(80);
	});

	it('agrees on membership and count for scored cases', { timeout: 120_000 }, () => {
		const failures: string[] = [];
		let compared = 0;
		for (const battery_case of comparableCases()) {
			if (!battery_case.tags.includes('scored')) continue;
			if (battery_case.query.distinct_on !== undefined) continue;
			const query = unpaged(battery_case.query);
			const ours = runEngine(loaded[battery_case.corpus], query);
			const theirs = orama[battery_case.corpus].search(query);
			compared++;
			if (sortedIds(ours.ids).join(',') !== sortedIds(theirs.ids).join(',')) {
				failures.push(
					`${battery_case.name}: membership (ours ${ours.ids.length}, orama ${theirs.ids.length})`,
				);
			} else if (ours.count !== theirs.count) {
				failures.push(`${battery_case.name}: count ${ours.count} vs ${theirs.count}`);
			}
		}
		expect(failures).toEqual([]);
		expect(compared).toBeGreaterThan(20);
	});

	it('agrees on the number of distinct groups', { timeout: 120_000 }, () => {
		const failures: string[] = [];
		let compared = 0;
		for (const battery_case of comparableCases()) {
			if (battery_case.query.distinct_on === undefined) continue;
			const query = unpaged(battery_case.query);
			const ours = runEngine(loaded[battery_case.corpus], query);
			const theirs = orama[battery_case.corpus].search(query);
			compared++;
			// Our `count` is post-distinct (report finding D); Orama's is the
			// pre-distinct total, so its *hit* count is the comparable number.
			if (ours.count !== theirs.ids.length) {
				failures.push(
					`${battery_case.name}: groups ${ours.count} vs ${theirs.ids.length}`,
				);
			}
		}
		expect(failures).toEqual([]);
		expect(compared).toBeGreaterThan(3);
	});

	it('agrees on facet counts', { timeout: 120_000 }, () => {
		const failures: string[] = [];
		let compared = 0;
		for (const battery_case of comparableCases()) {
			const definitions = battery_case.query.facets;
			if (!definitions) continue;
			const query = unpaged(battery_case.query);
			const ours = runEngine(loaded[battery_case.corpus], query);
			const theirs = orama[battery_case.corpus].search(query);
			if (!ours.facets || !theirs.facets) {
				failures.push(`${battery_case.name}: one side returned no facets`);
				continue;
			}
			for (const field of Object.keys(ours.facets)) {
				compared++;
				const our_facet = ours.facets[field];
				const their_facet = theirs.facets[field];
				if (!their_facet) {
					failures.push(`${battery_case.name}/${field}: missing from Orama`);
					continue;
				}
				// A windowed facet slices a list whose ties Orama orders differently
				// (ours is count desc, then value ascending by the core comparator),
				// so only the bucket total is comparable.
				if (isWindowedFacet(definitions[field])) {
					if (our_facet.count !== their_facet.count) {
						failures.push(
							`${battery_case.name}/${field}: bucket count ${our_facet.count} vs ${their_facet.count}`,
						);
					}
					continue;
				}
				// Boolean facets: Orama seeds both buckets and increments `false`
				// for any document whose value is not `true` — so a document
				// MISSING the field is counted as `false` there (verified: 603/397
				// over a 1000-doc corpus with one field-less document, where the
				// honest split is 603/396). Ours applies the §5 null rule and
				// counts neither bucket, and always reports both buckets so
				// `count` is always 2. Only the `true` bucket is comparable.
				if (isBooleanFacet(our_facet.values)) {
					// Orama also omits a bucket entirely when it is empty, so an
					// absent `true` there means zero.
					const their_true = their_facet.values.true ?? 0;
					if (our_facet.values.true !== their_true) {
						failures.push(
							`${battery_case.name}/${field}/true: ${our_facet.values.true} vs ${their_true}`,
						);
					}
					continue;
				}
				for (const [value, count] of Object.entries(their_facet.values)) {
					if (our_facet.values[value] !== count) {
						failures.push(
							`${battery_case.name}/${field}/${value}: ${our_facet.values[value]} vs ${count}`,
						);
					}
				}
				const our_values = Object.keys(our_facet.values).sort();
				const their_values = Object.keys(their_facet.values).sort();
				if (our_values.join(',') !== their_values.join(',')) {
					failures.push(`${battery_case.name}/${field}: value sets differ`);
				} else if (our_facet.count !== their_facet.count) {
					failures.push(
						`${battery_case.name}/${field}: bucket count ${our_facet.count} vs ${their_facet.count}`,
					);
				}
			}
		}
		expect(failures).toEqual([]);
		expect(compared).toBeGreaterThan(10);
	});
});

/* -------------------------------------------------------------------------- */
/* The divergence table is asserted, not merely declared                      */
/* -------------------------------------------------------------------------- */

describe(`documented divergences (${DIVERGENCE_SIZE} corpus)`, () => {
	const loaded = {} as Record<CorpusPresetName, LoadedCorpus>;
	const orama = {} as Record<CorpusPresetName, OramaReference>;

	beforeAll(() => {
		for (const preset of ['article', 'event'] as CorpusPresetName[]) {
			loaded[preset] = loadCorpus(preset, DIVERGENCE_SIZE);
			orama[preset] = createOramaReference(loaded[preset].corpus);
		}
	}, 120_000);

	/** `true` when the two engines observably disagree (throwing counts). */
	function diverges(battery_case: BatteryCase): boolean {
		const query = unpaged(battery_case.query);
		let ours: string;
		try {
			const result = runEngine(loaded[battery_case.corpus], query);
			ours = `${result.count}|${sortedIds(result.ids).join(',')}`;
		} catch {
			ours = 'THROW';
		}
		const theirs = tryOrama(orama[battery_case.corpus], query);
		if (!theirs.ok) return ours !== 'THROW';
		return ours !== `${theirs.result.count}|${sortedIds(theirs.result.ids).join(',')}`;
	}

	it('names only real battery cases', () => {
		const names = new Set(SEARCH_BATTERY.map((battery_case) => battery_case.name));
		for (const name of Object.keys(ORAMA_DIVERGENCES))
			expect(names, name).toContain(name);
		for (const name of DEVIATIONS_WITHOUT_MEMBERSHIP_DIFFERENCE) {
			expect(names, name).toContain(name);
		}
	});

	it('every excluded case really does diverge', { timeout: 120_000 }, () => {
		const agreeing: string[] = [];
		for (const name of Object.keys(ORAMA_DIVERGENCES)) {
			const battery_case = SEARCH_BATTERY.find((entry) => entry.name === name);
			if (!battery_case) continue;
			if (!diverges(battery_case)) agreeing.push(name);
		}
		// An entry that no longer diverges is an exclusion that has gone stale —
		// delete it and let the case rejoin the parity tier.
		expect(agreeing).toEqual([]);
	});

	it(
		'every deviation and known-bug case exhibits the documented behavior',
		{ timeout: 120_000 },
		() => {
			const unexpectedly_agreeing: string[] = [];
			for (const battery_case of SEARCH_BATTERY) {
				const is_deviation =
					battery_case.tags.includes('deviation') ||
					battery_case.tags.includes('orama-bug');
				if (!is_deviation) continue;
				if (DEVIATIONS_WITHOUT_MEMBERSHIP_DIFFERENCE.has(battery_case.name)) continue;
				if (!diverges(battery_case)) unexpectedly_agreeing.push(battery_case.name);
			}
			expect(unexpectedly_agreeing).toEqual([]);
		},
	);

	it('every orama-throws case really throws in Orama', { timeout: 120_000 }, () => {
		const not_throwing: string[] = [];
		let checked = 0;
		for (const battery_case of SEARCH_BATTERY) {
			if (!battery_case.tags.includes('orama-throws')) continue;
			checked++;
			const result = tryOrama(orama[battery_case.corpus], unpaged(battery_case.query));
			if (result.ok) not_throwing.push(battery_case.name);
		}
		expect(not_throwing).toEqual([]);
		expect(checked).toBeGreaterThan(3);
	});

	it(
		'every error case throws a 400 DelightError in the engine',
		{ timeout: 120_000 },
		() => {
			const failures: string[] = [];
			let checked = 0;
			for (const battery_case of SEARCH_BATTERY) {
				if (!battery_case.tags.includes('error')) continue;
				checked++;
				try {
					runEngine(loaded[battery_case.corpus], battery_case.query);
					failures.push(`${battery_case.name}: did not throw`);
				} catch (error) {
					if (!DelightError.is(error)) {
						failures.push(`${battery_case.name}: ${(error as Error).message}`);
					} else if (error.status !== 400) {
						failures.push(`${battery_case.name}: status ${error.status}`);
					}
				}
			}
			expect(failures).toEqual([]);
			expect(checked).toBeGreaterThanOrEqual(10);
		},
	);
});
