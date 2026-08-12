/**
 * The golden-vector replay (plan §8.2) — the permanent consistency guarantee.
 *
 * Loads the committed JSON suites under `golden/` and replays every frozen
 * answer against `core/*` plus the memory reference store. The **same files**
 * are replayed by the server driver over real DO SQLite (Phase 3) and the
 * client driver over IndexedDB (Phase 4), and byte-identical output is
 * required from all three: membership, order, counts and facets.
 *
 * Score *values* are deliberately absent from the fixtures — they are a
 * non-goal (plan §2). Order is not: every list is asserted in order, because
 * the primary-key ascending tie-break (§4.6, compared as the corpus's declared
 * PK type) guarantees a total order exists.
 *
 * Regenerating: see `golden/generate.ts`.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DelightError } from '@delightstack/utilities';
import { generateCorpus } from './fixtures/corpus';
import {
	GOLDEN_FORMAT_VERSION,
	type GoldenCorpusRef,
	type GoldenSuite,
} from './fixtures/golden_format';
import { GOLDEN_SUITES } from './golden/generate';
import { buildMemoryEngine, toEngineQuery } from './support';
import type { MemorySearchEngine } from '../memory/engine';

/** Reads a committed suite. Parsed rather than imported so `tsgo` never has to
 * infer a type for a 500KB JSON literal. */
function readSuite(file: string): GoldenSuite {
	const text = readFileSync(new URL(`./golden/${file}`, import.meta.url), 'utf8');
	return JSON.parse(text) as GoldenSuite;
}

/** A corpus reference's cache key. */
function corpusKey(ref: GoldenCorpusRef): string {
	return `${ref.preset}|${ref.size}|${ref.seed}`;
}

describe.each(GOLDEN_SUITES.map((spec) => spec.file))('golden suite %s', (file) => {
	let suite: GoldenSuite;
	const engines = new Map<string, MemorySearchEngine>();

	/** The engine for a vector's corpus, built once and reused. */
	function engineFor(ref: GoldenCorpusRef): MemorySearchEngine {
		const key = corpusKey(ref);
		const cached = engines.get(key);
		if (cached) return cached;
		const corpus = generateCorpus({ preset: ref.preset, size: ref.size, seed: ref.seed });
		// The tripwire from `golden_format.ts`: if a generator change alters the
		// corpus, fail here rather than in every single expectation.
		expect(corpus.docs.length, `${key} doc_count`).toBe(ref.doc_count);
		const engine = buildMemoryEngine(corpus);
		engines.set(key, engine);
		return engine;
	}

	beforeAll(() => {
		suite = readSuite(file);
	});

	it('is the format this runner understands', () => {
		expect(suite.format_version).toBe(GOLDEN_FORMAT_VERSION);
		expect(suite.generated_from).toBe('memory-reference');
		expect(suite.vectors.length + suite.error_vectors.length).toBeGreaterThan(0);
	});

	it('names every vector uniquely within its corpus', () => {
		const seen = new Set<string>();
		for (const vector of [...suite.vectors, ...suite.error_vectors]) {
			const key = `${corpusKey(vector.corpus_ref)}|${vector.name}`;
			expect(seen.has(key), key).toBe(false);
			seen.add(key);
		}
	});

	it('reproduces every frozen result', { timeout: 300_000 }, () => {
		const failures: string[] = [];
		for (const vector of suite.vectors) {
			const label = `${vector.name} @ ${corpusKey(vector.corpus_ref)}`;
			const engine = engineFor(vector.corpus_ref);
			let result;
			try {
				result = engine.search(toEngineQuery(vector.query));
			} catch (error) {
				failures.push(`${label}: threw ${(error as Error).message}`);
				continue;
			}
			const ids = result.hits.map((hit) => hit.id);
			if (JSON.stringify(ids) !== JSON.stringify(vector.expected_ids_in_order)) {
				failures.push(
					`${label}: ids ${JSON.stringify(ids).slice(0, 160)} != ${JSON.stringify(vector.expected_ids_in_order).slice(0, 160)}`,
				);
				continue;
			}
			if (result.count !== vector.expected_counts.total) {
				failures.push(
					`${label}: count ${result.count} != ${vector.expected_counts.total}`,
				);
			}
			if (ids.length !== vector.expected_counts.returned) {
				failures.push(
					`${label}: returned ${ids.length} != ${vector.expected_counts.returned}`,
				);
			}
			const expected_facets = vector.expected_facets;
			if (expected_facets) {
				if (JSON.stringify(result.facets) !== JSON.stringify(expected_facets)) {
					failures.push(
						`${label}: facets ${JSON.stringify(result.facets)} != ${JSON.stringify(expected_facets)}`,
					);
				}
			} else if (result.facets) {
				failures.push(`${label}: unexpected facets`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('reproduces every frozen rejection', { timeout: 300_000 }, () => {
		const failures: string[] = [];
		for (const vector of suite.error_vectors) {
			const label = `${vector.name} @ ${corpusKey(vector.corpus_ref)}`;
			const engine = engineFor(vector.corpus_ref);
			try {
				engine.search(toEngineQuery(vector.query));
				failures.push(`${label}: did not throw`);
			} catch (error) {
				if (!DelightError.is(error)) {
					failures.push(`${label}: threw a non-DelightError`);
					continue;
				}
				if (error.status !== vector.expected_status) {
					failures.push(`${label}: status ${error.status} != ${vector.expected_status}`);
				}
				const expected_message = vector.expected_message_contains;
				if (expected_message && !error.message.includes(expected_message)) {
					failures.push(`${label}: message "${error.message}"`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});

/* -------------------------------------------------------------------------- */
/* Coverage the plan makes mandatory                                          */
/* -------------------------------------------------------------------------- */

describe('golden coverage', () => {
	const suites = GOLDEN_SUITES.map((spec) => readSuite(spec.file));
	const all = suites.flatMap((suite) => [...suite.vectors, ...suite.error_vectors]);

	it('stays inside the fixture size budget', () => {
		const bytes = GOLDEN_SUITES.reduce(
			(total, spec) =>
				total +
				readFileSync(new URL(`./golden/${spec.file}`, import.meta.url), 'utf8').length,
			0,
		);
		expect(bytes).toBeLessThan(2_000_000);
	});

	it('covers every mandatory edge area from plan §8.2', () => {
		const required = [
			'geo-radius',
			'geo-polygon',
			'vector',
			'hybrid',
			'unicode',
			'tie-break',
			'null-handling',
			'tokenizer',
			'array-field',
			'child-path',
			'integer-pk',
			'distinct',
			'facets',
			'order',
			'paging',
			'error',
		];
		for (const tag of required) {
			const covered = all.some((vector) => vector.tags.includes(tag as never));
			expect(covered, tag).toBe(true);
		}
	});

	it('exercises an integer-primary-key corpus', () => {
		const integer_pk = all.filter((vector) => vector.corpus_ref.preset === 'event');
		expect(integer_pk.length).toBeGreaterThan(10);
	});

	it('freezes the two answers that had to be decided rather than observed', () => {
		// `limit: 0` — no hits, but `count` still reports the full matched total.
		const limit_zero = suites
			.flatMap((suite) => suite.vectors)
			.filter((vector) => vector.name === 'paging.limit_zero');
		expect(limit_zero.length).toBeGreaterThan(0);
		for (const vector of limit_zero) {
			expect(vector.expected_ids_in_order).toEqual([]);
			expect(vector.expected_counts.returned).toBe(0);
			expect(vector.expected_counts.total).toBe(vector.corpus_ref.doc_count);
		}

		// `contains_all: []` — vacuously TRUE wherever the field is a present
		// array, and still false when it is missing or null (§5 null rule). The
		// edge corpus contains `edge_null_rating` (label_ids: []) and
		// `edge_absent_rating` (no label_ids at all): the empty array matches, the
		// absent field does not.
		const contains_all_empty = suites
			.flatMap((suite) => suite.vectors)
			.filter((vector) => vector.name === 'where.enum_array.contains_all_empty_list');
		expect(contains_all_empty.length).toBeGreaterThan(0);
		for (const vector of contains_all_empty) {
			const corpus = generateCorpus({
				preset: vector.corpus_ref.preset,
				size: vector.corpus_ref.size,
				seed: vector.corpus_ref.seed,
			});
			const without_field = corpus.docs.filter(
				(doc) => !Array.isArray(doc.label_ids),
			).length;
			expect(vector.expected_ids_in_order).toContain('edge_null_rating');
			expect(vector.expected_counts.total).toBe(corpus.docs.length - without_field);
			if (without_field > 0) {
				expect(vector.expected_ids_in_order).not.toContain('edge_absent_rating');
			}
		}

		// `contains_any: []` and `in: []` match NOTHING — they share one branch in
		// `core/where.ts`, so the scalar `in: []` case pins both.
		const contains_any_empty = suites
			.flatMap((suite) => suite.vectors)
			.filter((vector) => vector.name === 'where.enum.in_empty');
		expect(contains_any_empty.length).toBeGreaterThan(0);
		for (const vector of contains_any_empty) {
			expect(vector.expected_ids_in_order).toEqual([]);
			expect(vector.expected_counts.total).toBe(0);
		}
	});
});
