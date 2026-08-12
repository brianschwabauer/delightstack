/**
 * Golden-vector generation (plan §8.2).
 *
 * Runs the query battery through the **memory reference engine** and freezes
 * the answers as JSON under `search/__tests__/golden/`. The same files are
 * replayed by `golden.test.ts` today and, in Phases 3–4, by the server driver
 * over DO SQLite and the client driver over IndexedDB — byte-identical output
 * required from all three. That is the mechanism that keeps the drivers two
 * implementations of one specification.
 *
 * ## Running it
 *
 * ```sh
 * DELIGHT_REGEN_GOLDEN=1 pnpm --filter @delightstack/database exec vitest run \
 *   src/search/__tests__/golden/regenerate.test.ts
 * ```
 *
 * Without the environment variable that test is skipped, so an ordinary test
 * run never rewrites the fixtures. Regenerate only when the spec deliberately
 * changes — then re-audit, because a golden vector is only worth what its last
 * hand-audit was worth.
 *
 * ## The three suites
 *
 * | File | Corpora | Cases | Why |
 * |---|---|---|---|
 * | `tiny.json` | 10 docs | all | fast smoke pass; astral ordering and string-PK `'10' < '2'` live in the first ten documents |
 * | `edges.json` | every hand-authored edge document, no generated ones (69 article / 20 event) | all | the mandatory §8.2 edge coverage — geo boundaries and polygon vertices, vectors, emails, tie-breaks, distinct groups — all live past document ten, so `tiny` cannot cover them, and a corpus of *only* hand-authored documents is the one that can be audited by hand |
 * | `small.json` | 1000 docs | `scored` + `facets` cases | the only place corpus statistics change an answer: BM25 `idf`/`avgLen`, `threshold` fractions, facet bucket counts |
 *
 * Sizing: the suites total well under the 2MB budget because the two whole-
 * battery suites run over deliberately small corpora and the 1000-document
 * suite is restricted to the cases whose answers depend on corpus statistics.
 */

import { DelightError } from '@delightstack/utilities';
import type { FacetResult } from '../../core/types';
import {
	SEARCH_BATTERY,
	type BatteryCase,
	type FixtureSearchQuery,
} from '../fixtures/battery';
import {
	generateCorpus,
	type CorpusPresetName,
	type CorpusSizeName,
} from '../fixtures/corpus';
import {
	GOLDEN_FORMAT_VERSION,
	type GoldenCorpusRef,
	type GoldenErrorVector,
	type GoldenFacet,
	type GoldenSuite,
	type GoldenVector,
} from '../fixtures/golden_format';
import { buildMemoryEngine, toEngineQuery } from '../support';

/** Which implementation produced the answers. Recorded in every suite. */
export const GENERATED_FROM = 'memory-reference';

/**
 * The number of hand-authored edge documents each preset defines. Using exactly
 * this many gives a corpus of *only* hand-authored documents — every value in
 * it is written down in `corpus.ts` and can therefore be checked by hand.
 * A generator change that adds an edge document changes these numbers; the
 * `doc_count` tripwire in every `corpus_ref` catches it loudly.
 */
export const EDGE_DOCUMENT_COUNTS: Record<CorpusPresetName, number> = {
	article: 74,
	event: 20,
};

/** One corpus a suite draws from. */
export interface SuiteCorpus {
	preset: CorpusPresetName;
	size: CorpusSizeName | number;
}

/** A committed golden file and the rule for what goes in it. */
export interface GoldenSuiteSpec {
	/** File name inside `golden/`. */
	file: string;
	description: string;
	corpora: SuiteCorpus[];
	/** Which battery cases this suite freezes. */
	includes(battery_case: BatteryCase): boolean;
}

/** The committed suites, in generation order. */
export const GOLDEN_SUITES: GoldenSuiteSpec[] = [
	{
		file: 'tiny.json',
		description:
			'Every battery case over the ten-document corpora (plan §8.2). Covers astral-plane ordering and the string-PK tie-break, both of which live in the first ten documents.',
		corpora: [
			{ preset: 'article', size: 'tiny' },
			{ preset: 'event', size: 'tiny' },
		],
		includes: () => true,
	},
	{
		file: 'edges.json',
		description:
			'Every battery case over a corpus made up of nothing but the hand-authored edge documents. This is where the mandatory §8.2 coverage lives: geo boundary/vertex/missing-geopoint, vectors and hybrid, email tokenization, equal sort keys, distinct groups, null vs absent, empty string/array, the 64-character token cap.',
		corpora: [
			{ preset: 'article', size: EDGE_DOCUMENT_COUNTS.article },
			{ preset: 'event', size: EDGE_DOCUMENT_COUNTS.event },
		],
		includes: () => true,
	},
	{
		file: 'small.json',
		description:
			'Scored and faceted cases over the thousand-document corpora — the only answers that move with corpus statistics (BM25 idf/avgLen, fractional `threshold`, facet bucket counts).',
		corpora: [
			{ preset: 'article', size: 'small' },
			{ preset: 'event', size: 'small' },
		],
		includes: (battery_case) =>
			battery_case.tags.includes('scored') || battery_case.tags.includes('facets'),
	},
];

/** The deterministic seed a suite corpus uses. Readable, and recorded verbatim. */
export function seedFor(corpus: SuiteCorpus): string {
	return `${corpus.preset}-${corpus.size}`;
}

/** Converts the engine's facet result into the frozen fixture shape. */
function toGoldenFacets(facets: FacetResult): Record<string, GoldenFacet> {
	const out: Record<string, GoldenFacet> = {};
	for (const field of Object.keys(facets)) {
		out[field] = { count: facets[field].count, values: { ...facets[field].values } };
	}
	return out;
}

/**
 * Runs one case and freezes the answer.
 *
 * Two answers in here are **frozen decisions**, not observations — both are
 * recorded in the case's `notes` and in plan §4.7/§5:
 *
 * - `limit: 0` returns no `hits` while `count` still reports the full matched
 *   total (the same split Orama produces, and the only reading that keeps
 *   `count` a property of the query rather than of the page).
 * - `contains_all: []` is vacuously **true** for any document whose field is
 *   present as an array — and still false when the field is missing or null,
 *   per the §5 null rule. `contains_any: []` matches **nothing**.
 */
function buildVector(
	battery_case: BatteryCase,
	corpus_ref: GoldenCorpusRef,
	engine: ReturnType<typeof buildMemoryEngine>,
): { vector?: GoldenVector; error_vector?: GoldenErrorVector } {
	const query = battery_case.query as FixtureSearchQuery;
	try {
		const result = engine.search(toEngineQuery(query));
		return {
			vector: {
				name: battery_case.name,
				corpus_ref,
				query,
				expected_ids_in_order: result.hits.map((hit) => hit.id),
				expected_counts: { total: result.count, returned: result.hits.length },
				...(result.facets ? { expected_facets: toGoldenFacets(result.facets) } : {}),
				tags: battery_case.tags,
				...(battery_case.notes ? { notes: battery_case.notes } : {}),
			},
		};
	} catch (error) {
		if (!DelightError.is(error)) {
			// A non-DelightError escaping the engine is a bug, never a fixture.
			throw new Error(
				`${battery_case.name}: expected a DelightError, got ${String(error)}`,
			);
		}
		return {
			error_vector: {
				name: battery_case.name,
				corpus_ref,
				query,
				expected_status: error.status,
				expected_message_contains: error.message,
				tags: battery_case.tags,
				...(battery_case.notes ? { notes: battery_case.notes } : {}),
			},
		};
	}
}

/** Builds one suite by running every case it includes against every corpus it names. */
export function buildGoldenSuite(spec: GoldenSuiteSpec): GoldenSuite {
	const vectors: GoldenVector[] = [];
	const error_vectors: GoldenErrorVector[] = [];
	for (const suite_corpus of spec.corpora) {
		const seed = seedFor(suite_corpus);
		const corpus = generateCorpus({ ...suite_corpus, seed });
		const engine = buildMemoryEngine(corpus);
		const corpus_ref: GoldenCorpusRef = {
			preset: suite_corpus.preset,
			size: suite_corpus.size,
			seed,
			doc_count: corpus.docs.length,
		};
		for (const battery_case of SEARCH_BATTERY) {
			if (battery_case.corpus !== suite_corpus.preset) continue;
			if (!spec.includes(battery_case)) continue;
			const built = buildVector(battery_case, corpus_ref, engine);
			if (built.vector) vectors.push(built.vector);
			if (built.error_vector) error_vectors.push(built.error_vector);
		}
	}
	return {
		format_version: GOLDEN_FORMAT_VERSION,
		generated_from: GENERATED_FROM,
		description: spec.description,
		vectors,
		error_vectors,
	};
}

/**
 * Serializes a suite one vector per line.
 *
 * Fully indented JSON would put every expected id on its own line and roughly
 * triple the committed bytes; a single compact line would make every
 * regeneration an unreadable diff. One line per vector gives readable diffs at
 * compact size.
 */
export function stringifyGoldenSuite(suite: GoldenSuite): string {
	const lines: string[] = ['{'];
	lines.push(`\t"format_version": ${JSON.stringify(suite.format_version)},`);
	lines.push(`\t"generated_from": ${JSON.stringify(suite.generated_from)},`);
	lines.push(`\t"description": ${JSON.stringify(suite.description ?? '')},`);
	const block = (key: string, entries: unknown[], trailing_comma: boolean): void => {
		if (entries.length === 0) {
			lines.push(`\t"${key}": []${trailing_comma ? ',' : ''}`);
			return;
		}
		lines.push(`\t"${key}": [`);
		entries.forEach((entry, index) => {
			lines.push(
				`\t\t${JSON.stringify(entry)}${index === entries.length - 1 ? '' : ','}`,
			);
		});
		lines.push(`\t]${trailing_comma ? ',' : ''}`);
	};
	block('vectors', suite.vectors, true);
	block('error_vectors', suite.error_vectors, false);
	lines.push('}');
	return `${lines.join('\n')}\n`;
}

/** Builds every committed suite. */
export function buildAllGoldenSuites(): { file: string; suite: GoldenSuite }[] {
	return GOLDEN_SUITES.map((spec) => ({
		file: spec.file,
		suite: buildGoldenSuite(spec),
	}));
}
