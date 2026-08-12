/**
 * The golden-vector fixture format (plan §8.2).
 *
 * A golden vector is a frozen answer: one query, over one deterministically
 * regenerable corpus, with the exact result the engine must produce. The
 * *same* fixture file runs against all three backends —
 *
 * 1. `core/*` + the memory reference store (vitest),
 * 2. the server driver over real DO SQLite (miniflare),
 * 3. the client driver over IndexedDB (fake-indexeddb, plus real-browser
 *    passes in Chrome and at least one non-V8 engine)
 *
 * — and byte-identical output is required from all of them. That is the
 * mechanism that keeps the two drivers implementations of one specification
 * rather than two engines that happen to agree today.
 *
 * **This module defines the shape only.** Fixtures are generated later, once,
 * from the memory reference implementation, then hand-audited and committed to
 * `search/__tests__/golden/`. There is deliberately no generation logic here —
 * a generator that lived alongside the assertions could drift with them.
 */

import type { CorpusPresetName, CorpusSizeName } from './corpus';
import type { BatteryTag, FixtureSearchQuery } from './battery';

/**
 * How to rebuild the corpus a golden vector was generated against.
 *
 * Corpora are never committed — they are regenerated from
 * `generateCorpus(corpus_ref)`, which is a pure function of these three
 * values. `doc_count` is recorded separately as a cheap tripwire: if a
 * generator change alters the corpus, the count check fails loudly instead of
 * every expectation failing mysteriously.
 */
export interface GoldenCorpusRef {
	preset: CorpusPresetName;
	size: CorpusSizeName | number;
	seed: number | string;
	/** Documents the corpus had when the vector was generated. */
	doc_count: number;
}

/** A single facet's frozen counts — mirrors `core/types.ts` `FacetResult`. */
export interface GoldenFacet {
	/** Number of distinct values (string facets) or configured buckets. */
	count: number;
	/**
	 * Value → document count. Insertion order is significant: facet values are
	 * ordered count-descending, then value-ascending by the core comparator
	 * (plan §4.8), and JSON round-trips preserve that order for string keys.
	 */
	values: Record<string, number>;
}

/** The counts a query must report. */
export interface GoldenCounts {
	/**
	 * `SearchQueryResults.count` — the size of the matched set after `where`,
	 * `term` and `distinct_on`, before `limit`/`offset`.
	 *
	 * Note the frozen deviation from Orama (verification report finding D):
	 * Orama reports the *pre*-distinct count; we report the post-distinct one.
	 */
	total: number;
	/** `hits.length` — after `limit`/`offset`. */
	returned: number;
}

/** One frozen query result. */
export interface GoldenVector {
	/** The `BatteryCase.name` this vector was generated from. */
	name: string;
	corpus_ref: GoldenCorpusRef;
	query: FixtureSearchQuery;
	/**
	 * Primary keys of the returned hits, **in result order**. Membership *and*
	 * order are both asserted — ties are resolved by the primary-key ascending
	 * tie-break (plan §4.6), compared as the corpus's declared PK type, so a
	 * stable order always exists.
	 *
	 * Scores are deliberately absent: score *values* are a non-goal (plan §2).
	 */
	expected_ids_in_order: (string | number)[];
	expected_counts: GoldenCounts;
	/** Present only when the query requested facets. */
	expected_facets?: Record<string, GoldenFacet>;
	/** Copied from the battery case so a runner can skip by tag. */
	tags: BatteryTag[];
	/** Why this answer is what it is — carried over from `BatteryCase.notes`. */
	notes?: string;
}

/**
 * A vector for a case that must fail. `error` cases in the battery produce
 * these instead of a `GoldenVector`.
 */
export interface GoldenErrorVector {
	name: string;
	corpus_ref: GoldenCorpusRef;
	query: FixtureSearchQuery;
	/** Every query-shape failure is a `DelightError` with this status. */
	expected_status: number;
	/** Substring the thrown message must contain. Kept loose on purpose. */
	expected_message_contains?: string;
	tags: BatteryTag[];
	notes?: string;
}

/** One committed golden file. */
export interface GoldenSuite {
	/**
	 * Bumped whenever the *format* changes. A mismatch means the runner is
	 * older than the fixtures (or vice versa) — fail, do not guess.
	 */
	format_version: 1;
	/** Which implementation produced these answers, e.g. `'memory-reference'`. */
	generated_from: string;
	/** Free-form provenance, e.g. the plan section the suite covers. */
	description?: string;
	vectors: GoldenVector[];
	error_vectors: GoldenErrorVector[];
}

/** The current golden-fixture format version. */
export const GOLDEN_FORMAT_VERSION = 1 as const;
