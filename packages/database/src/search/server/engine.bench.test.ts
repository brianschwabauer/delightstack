// @vitest-environment node
/**
 * Benchmark smoke test for the server driver (plan §8.3).
 *
 * **Non-gating and opt-in** — run with `DELIGHT_SEARCH_BENCH=1`. It logs
 * numbers against the plan's targets rather than asserting thresholds: the
 * point is the trend across changes, not an absolute number on one machine,
 * and a threshold here would fail on a loaded CI box for no useful reason.
 *
 * The numbers are also *not* DO numbers. This runs `node:sqlite` on a dev
 * machine, so treat them as a relative floor: real Durable Object storage adds
 * its own per-statement overhead.
 *
 * Two corpora run by default, 10k and 100k, because the interesting question is
 * not any single number but which of them **scale with the corpus**: a term
 * search's cost should track the postings it touches and the page it returns,
 * never the document count. Set `DELIGHT_SEARCH_BENCH_SIZE` to run one size.
 *
 * Targets (§8.3): single-doc index write < 5ms at scale; text search
 * (2 tokens, tolerance 1) < 30ms at 100k; filter+sort-only < 5ms.
 */

import { describe, expect, it } from 'vitest';
import { createPrng } from '../__tests__/fixtures/prng';
import {
	createEntityTable,
	insertEntityRow,
	NodeSqlStorage,
} from '../__tests__/sqlite_harness';
import type { WhereSchema } from '../core/where';
import { SqliteSearchEngine } from './engine';

const CORPUS_SIZES = process.env.DELIGHT_SEARCH_BENCH_SIZE
	? [Number(process.env.DELIGHT_SEARCH_BENCH_SIZE)]
	: [10_000, 100_000];

const SCHEMA: WhereSchema = {
	id: 'string',
	title: 'string',
	body: 'string',
	status: 'enum',
	rating: 'number',
	tags: 'string[]',
	'address.city': 'string',
	updated_at: 'number',
};

/**
 * A Zipf-ish vocabulary. Posting-list *length* is what a term query's cost is
 * proportional to, so a tiny vocabulary (where every token is in every
 * document) measures a corpus nobody has. 4k words sampled with a squared
 * distribution gives a realistic head/tail split, plus a handful of hand-picked
 * prefix families so prefix expansion and tolerance have something to chew on.
 */
const VOCABULARY: string[] = [
	'data',
	'database',
	'dataset',
	'datum',
	'token',
	'tokenizer',
	'index',
	'indexing',
	...Array.from({ length: 4000 }, (_, index) => `term${index}`),
];

const CITIES = ['Zürich', 'Tokyo', 'Berlin', 'Lima', 'Oslo'];
const STATUSES = ['published', 'draft', 'archived'];

/** A deterministic document. */
function makeDocument(index: number): Record<string, unknown> {
	const prng = createPrng(`bench-${index}`);
	const pick = (list: readonly string[]): string => list[prng.int(0, list.length - 1)];
	return {
		id: `doc_${String(index).padStart(7, '0')}`,
		title: `${zipf(prng)} ${zipf(prng)} ${zipf(prng)}`,
		body: Array.from({ length: 30 }, () => zipf(prng)).join(' '),
		status: pick(STATUSES),
		rating: prng.int(0, 100),
		tags: [zipf(prng), zipf(prng)],
		address: { city: pick(CITIES) },
		updated_at: 1_700_000_000_000 + index,
	};
}

/** A vocabulary word, skewed so a few terms are common and most are rare. */
function zipf(prng: { next(): number }): string {
	const skewed = prng.next() * prng.next();
	return VOCABULARY[
		Math.min(VOCABULARY.length - 1, Math.floor(skewed * VOCABULARY.length))
	];
}

/** Milliseconds for one call. */
function timed(run: () => void): number {
	const started = performance.now();
	run();
	return performance.now() - started;
}

/**
 * Mean milliseconds over `runs`, after one warm-up.
 *
 * A single cold call is dominated by SQLite preparing each statement shape for
 * the first time, which is a one-off cost a Durable Object pays once per boot —
 * not the per-operation cost these targets are about.
 */
function averaged(run: () => void, runs = 20): number {
	run();
	let total = 0;
	for (let index = 0; index < runs; index++) total += timed(run);
	return total / runs;
}

/** Every §8.3 number for one corpus size. */
function measure(corpus_size: number): Record<string, number> {
	const sql = new NodeSqlStorage();
	sql.record = false;
	const engine = new SqliteSearchEngine(sql);
	engine.bootstrap();
	const table = createEntityTable(sql, {
		entity_type: 'article',
		table_name: 'articles',
		schema: SCHEMA,
		primary_key: 'id',
		primary_key_type: 'string',
	});
	engine.register(table);
	// The §7.4 `updated_at` index: the dominant query orders by it, and
	// without the index the fast path degrades to a scan plus a sort.
	sql.exec('CREATE INDEX idx_articles_updated_at ON articles (updated_at, id);');
	sql.exec('CREATE INDEX idx_articles_status ON articles (status);');

	// Documents are generated one at a time rather than up front: holding 100k
	// of them alive competes with SQLite for memory and skews the read numbers.
	const bulk = timed(() => {
		for (let index = 0; index < corpus_size; index++) {
			const document = makeDocument(index);
			insertEntityRow(sql, table, document);
			engine.indexDocument('article', String(document.id), document);
		}
	});

	// Single-doc write at full corpus size, both branches of §7.2.
	const target = makeDocument(corpus_size >> 1);
	const updated = { ...target, title: 'freshly rewritten title tokens' };
	const write_with_previous = averaged(() => {
		engine.indexDocument('article', String(target.id), updated, target);
		engine.indexDocument('article', String(target.id), target, updated);
	});
	const write_fallback = averaged(() => {
		engine.indexDocument('article', String(target.id), target);
	});

	// Text search: two tokens, tolerance 1. Both tokens are one edit from a HEAD
	// term, so this expands the whole dictionary and then walks the longest
	// posting lists in the corpus — the worst case the target is written for.
	const search_cold = timed(() => {
		engine.list('article', { term: 'datbase tokan', tolerance: 1, limit: 20 });
	});
	const search_warm = averaged(() => {
		engine.list('article', { term: 'datbase tokan', tolerance: 1, limit: 20 });
	}, 5);
	const search_prefix = averaged(() => {
		engine.list('article', { term: 'dat tok', limit: 20 });
	}, 5);
	// The same search with `order[]` — documents cannot be deferred to the page,
	// so this is the term path's fully-hydrated cost.
	const search_ordered = averaged(() => {
		engine.list('article', {
			term: 'datbase tokan',
			tolerance: 1,
			limit: 20,
			order: [{ field: 'rating', direction: 'DESC' }],
		});
	}, 5);

	// Filter + sort only — the dominant query, and the fast path.
	const filter_sort = averaged(() => {
		engine.list('article', {
			where: { status: 'published' },
			order: [{ field: 'updated_at', direction: 'DESC' }],
			limit: 20,
		});
	});
	const filter_sort_child = averaged(() => {
		engine.list('article', {
			where: { 'address.city': 'Zürich' },
			order: [{ field: 'rating', direction: 'DESC' }],
			limit: 20,
		});
	});

	const matched = engine.list('article', {
		term: 'datbase tokan',
		tolerance: 1,
		limit: 20,
	}).count;
	sql.close();
	return {
		corpus: corpus_size,
		matched_documents: matched,
		bulk_index_ms: round(bulk),
		bulk_index_ms_per_doc: round(bulk / corpus_size),
		// Two writes per iteration (there and back), so halve it.
		single_write_with_previous_ms: round(write_with_previous / 2),
		single_write_returning_fallback_ms: round(write_fallback),
		search_2_tokens_tolerance_1_cold_ms: round(search_cold),
		search_2_tokens_tolerance_1_warm_ms: round(search_warm),
		search_2_tokens_tolerance_1_ordered_ms: round(search_ordered),
		search_2_tokens_prefix_ms: round(search_prefix),
		filter_sort_fast_path_ms: round(filter_sort),
		filter_sort_child_path_ms: round(filter_sort_child),
	};
}

describe.skipIf(!process.env.DELIGHT_SEARCH_BENCH)('server driver benchmarks', () => {
	it(
		`indexes ${CORPUS_SIZES.join(' and ')} documents and reports §8.3 numbers`,
		{ timeout: 3_600_000 },
		() => {
			const report: Record<string, Record<string, number>> = {};
			for (const size of CORPUS_SIZES) {
				report[`${size} docs`] = measure(size);
			}
			console.log(
				'\n§8.3 targets: write < 5ms · text search (2 tokens, tolerance 1) < 30ms at 100k · filter+sort < 5ms',
			);
			console.table(report);
			// Non-gating: only assert that every run produced answers at all.
			for (const size of CORPUS_SIZES) {
				expect(report[`${size} docs`].matched_documents).toBeGreaterThan(0);
			}
		},
	);
});

/** Two decimal places. */
function round(value: number): number {
	return Math.round(value * 100) / 100;
}
