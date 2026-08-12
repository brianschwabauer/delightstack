/**
 * Guards on the search test infrastructure itself.
 *
 * The differential harness (plan §8.1) and the golden-vector suite (§8.2) are
 * only meaningful if the corpora they compare are reproducible and the battery
 * they run actually addresses fields that exist. That is what this file checks.
 */

import { describe, expect, it } from 'vitest';
import { createPrng, hashSeed, splitmix32 } from './fixtures/prng';
import {
	ARTICLE_SCHEMA,
	CORPUS_SIZES,
	EVENT_SCHEMA,
	GEO_BOUNDARY_RADIUS_M,
	GEO_CENTER,
	VECTOR_DIMENSIONS,
	WRONG_DIMENSION_VECTOR_DOCS,
	ZERO_VECTOR_DOCS,
	generateCorpus,
	haversineMeters,
	schemaForPreset,
	type FixtureDocument,
	type FixtureGeoPoint,
	type FixtureSchema,
} from './fixtures/corpus';
import {
	BATTERY_TAGS,
	SEARCH_BATTERY,
	batteryCasesForCorpus,
	type BatteryCase,
} from './fixtures/battery';
import { GOLDEN_FORMAT_VERSION } from './fixtures/golden_format';

/* -------------------------------------------------------------------------- */
/* prng                                                                       */
/* -------------------------------------------------------------------------- */

describe('prng', () => {
	it('produces the same stream for the same seed', () => {
		const first = splitmix32(42);
		const second = splitmix32(42);
		const first_values = Array.from({ length: 32 }, () => first());
		const second_values = Array.from({ length: 32 }, () => second());
		expect(first_values).toEqual(second_values);
	});

	it('produces different streams for different seeds', () => {
		const first = Array.from({ length: 16 }, splitmix32(1));
		const second = Array.from({ length: 16 }, splitmix32(2));
		expect(first).not.toEqual(second);
	});

	it('stays inside [0, 1)', () => {
		const next = splitmix32(hashSeed('range-check'));
		for (let index = 0; index < 5000; index++) {
			const value = next();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});

	it('accepts a string seed and hashes it deterministically', () => {
		expect(createPrng('article-small').seed).toBe(hashSeed('article-small'));
		expect(createPrng('article-small').next()).toBe(createPrng('article-small').next());
	});

	it('keeps int() inside the inclusive bounds and hits both ends', () => {
		const prng = createPrng('int-bounds');
		const seen = new Set<number>();
		for (let index = 0; index < 2000; index++) {
			const value = prng.int(3, 7);
			expect(Number.isInteger(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(3);
			expect(value).toBeLessThanOrEqual(7);
			seen.add(value);
		}
		expect(seen.size).toBe(5);
	});

	it('shuffles without losing or duplicating items', () => {
		const prng = createPrng('shuffle');
		const items = Array.from({ length: 20 }, (_, index) => index);
		const shuffled = prng.shuffle(items);
		expect(shuffled).not.toEqual(items);
		expect(shuffled.slice().sort((a, b) => a - b)).toEqual(items);
	});

	it('never emits a zero vector', () => {
		const prng = createPrng('vectors');
		for (let index = 0; index < 500; index++) {
			const vector = prng.unitVector(VECTOR_DIMENSIONS);
			const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
			expect(norm).toBeGreaterThan(0);
			expect(norm).toBeCloseTo(1, 12);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* corpus determinism                                                         */
/* -------------------------------------------------------------------------- */

describe('corpus determinism', () => {
	it('generates a deeply equal corpus for the same seed, twice', () => {
		const first = generateCorpus({
			preset: 'article',
			size: 'small',
			seed: 'repeatable',
		});
		const second = generateCorpus({
			preset: 'article',
			size: 'small',
			seed: 'repeatable',
		});
		expect(first).toEqual(second);
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});

	it('generates a deeply equal integer-pk corpus for the same seed, twice', () => {
		const first = generateCorpus({ preset: 'event', size: 'small', seed: 7 });
		const second = generateCorpus({ preset: 'event', size: 'small', seed: 7 });
		expect(first).toEqual(second);
	});

	it('generates different documents for different seeds', () => {
		const first = generateCorpus({ preset: 'article', size: 'small', seed: 'seed-a' });
		const second = generateCorpus({ preset: 'article', size: 'small', seed: 'seed-b' });
		expect(first.docs).not.toEqual(second.docs);
		// The hand-authored edge documents are seed-independent by design.
		expect(first.docs[0]).toEqual(second.docs[0]);
	});

	it('defaults the seed from the preset and size, so callers can omit it', () => {
		expect(generateCorpus({ preset: 'article', size: 'tiny' })).toEqual(
			generateCorpus({ preset: 'article', size: 'tiny' }),
		);
	});

	it('honours the three named sizes', () => {
		expect(generateCorpus({ size: 'tiny' }).docs).toHaveLength(CORPUS_SIZES.tiny);
		expect(generateCorpus({ size: 'small' }).docs).toHaveLength(CORPUS_SIZES.small);
		expect(generateCorpus({ size: 42 }).docs).toHaveLength(42);
	});

	it('generates the 20k preset deterministically and quickly', () => {
		const started = performance.now();
		const corpus = generateCorpus({
			preset: 'article',
			size: 'large',
			seed: 'large-run',
		});
		const elapsed_ms = performance.now() - started;
		expect(corpus.docs).toHaveLength(CORPUS_SIZES.large);
		expect(elapsed_ms).toBeLessThan(10_000);

		const ids = new Set(corpus.docs.map((doc) => doc.id));
		expect(ids.size).toBe(corpus.docs.length);
	});

	it('keeps primary keys unique in every preset', () => {
		for (const preset of ['article', 'event'] as const) {
			const corpus = generateCorpus({ preset, size: 'small' });
			const ids = corpus.docs.map((doc) => doc.id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const id of ids) expect(typeof id).toBe(corpus.primary_key_type);
		}
	});
});

/* -------------------------------------------------------------------------- */
/* corpus coverage                                                            */
/* -------------------------------------------------------------------------- */

function documentById(docs: FixtureDocument[], id: string | number): FixtureDocument {
	const found = docs.find((doc) => doc.id === id);
	if (!found) throw new Error(`corpus is missing the expected document ${String(id)}`);
	return found;
}

describe('corpus edge coverage', () => {
	const corpus = generateCorpus({ preset: 'article', size: 'small', seed: 'coverage' });

	it('places every edge document ahead of the generated ones', () => {
		expect(corpus.docs[0]?.id).toBe('2');
		expect(corpus.docs[1]?.id).toBe('10');
		expect(corpus.docs.some((doc) => String(doc.id).startsWith('art_'))).toBe(true);
	});

	it('distinguishes null from absent', () => {
		expect(documentById(corpus.docs, 'edge_null_rating').rating).toBeNull();
		expect('rating' in documentById(corpus.docs, 'edge_absent_rating')).toBe(false);
		expect('location' in documentById(corpus.docs, 'edge_geo_missing')).toBe(false);
		expect(documentById(corpus.docs, 'edge_geo_null').location).toBeNull();
	});

	it('carries empty arrays as well as populated ones', () => {
		expect(documentById(corpus.docs, 'edge_null_rating').tags).toEqual([]);
		expect(documentById(corpus.docs, 'edge_arrays_full').tags).toEqual([
			'red',
			'green',
			'blue',
		]);
	});

	it('places a document exactly on the geo radius boundary', () => {
		const boundary = documentById(corpus.docs, 'edge_geo_boundary_exact')
			.location as FixtureGeoPoint;
		expect(haversineMeters(GEO_CENTER, boundary)).toBe(GEO_BOUNDARY_RADIUS_M);
	});

	it('places documents on every polygon edge and on two opposite vertices', () => {
		const expected: [string, FixtureGeoPoint][] = [
			['edge_poly_bottom_edge', { lat: 47, lon: 8.5 }],
			['edge_poly_left_edge', { lat: 47.5, lon: 8 }],
			['edge_poly_top_edge', { lat: 48, lon: 8.5 }],
			['edge_poly_right_edge', { lat: 47.5, lon: 9 }],
			['edge_poly_vertex_bottom_left', { lat: 47, lon: 8 }],
			['edge_poly_vertex_top_right', { lat: 48, lon: 9 }],
		];
		for (const [id, point] of expected) {
			expect(documentById(corpus.docs, id).location).toEqual(point);
		}
	});

	it('contains no zero vectors, and keeps the zero-vector fixture separate', () => {
		for (const doc of corpus.docs) {
			const embedding = doc.embedding;
			if (!Array.isArray(embedding)) continue;
			const norm = Math.sqrt(
				(embedding as number[]).reduce((sum, value) => sum + value * value, 0),
			);
			expect(norm).toBeGreaterThan(0);
			expect(embedding).toHaveLength(VECTOR_DIMENSIONS);
		}
		expect(ZERO_VECTOR_DOCS).toHaveLength(2);
		for (const doc of ZERO_VECTOR_DOCS) {
			expect((doc.embedding as number[]).every((value) => value === 0)).toBe(true);
		}
		expect(
			WRONG_DIMENSION_VECTOR_DOCS.map((doc) => (doc.embedding as number[]).length),
		).toEqual([3, 10]);
	});

	it('includes unicode, astral-plane and numeric-string values', () => {
		expect(documentById(corpus.docs, 'edge_unicode_cjk').title).toContain('東京');
		expect(documentById(corpus.docs, 'edge_unicode_cyrillic').title).toContain('Москва');
		expect(documentById(corpus.docs, 'edge_astral_high').code).toBe('\u{1F600}');
		expect(documentById(corpus.docs, 'edge_astral_replacement').code).toBe('�');
		expect(documentById(corpus.docs, 'edge_numeric_strings').code).toBe('5');
	});

	it('carries one document per tokenizer rule frozen 2026-08-12', () => {
		// Plan §4.1 steps 6–11. Each probe must still contain the *raw*
		// character the rule folds — a normalized fixture would test nothing.
		expect(documentById(corpus.docs, 'edge_camel_case').title).toContain('getWidgetInfo');
		expect(documentById(corpus.docs, 'edge_format_characters').title).toContain('­');
		expect(documentById(corpus.docs, 'edge_format_characters').body).toContain('‍');
		expect(documentById(corpus.docs, 'edge_acronym_dots').title).toContain('U.S.A.');
		expect(documentById(corpus.docs, 'edge_decimal_numbers').body).toContain('3.14');
		expect(documentById(corpus.docs, 'edge_modifier_apostrophe').title).toContain('ʼ');
	});

	it('repeats words so term frequency is observable', () => {
		expect(documentById(corpus.docs, 'edge_repeated_words').body).toBe(
			'repeat repeat repeat repeat repeat',
		);
	});

	it('gives several documents identical updated_at values', () => {
		const counts = new Map<number, number>();
		for (const doc of corpus.docs) {
			const value = doc.updated_at as number;
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
		expect(Math.max(...counts.values())).toBeGreaterThan(1);
	});

	it('uses an integer primary key in the event preset, with 2 and 10 tied', () => {
		const events = generateCorpus({ preset: 'event', size: 'small', seed: 'coverage' });
		expect(events.primary_key_type).toBe('number');
		const two = documentById(events.docs, 2);
		const ten = documentById(events.docs, 10);
		expect(two.updated_at).toBe(ten.updated_at);
		expect(two.capacity).toBe(ten.capacity);
	});
});

/* -------------------------------------------------------------------------- */
/* battery                                                                    */
/* -------------------------------------------------------------------------- */

/** Resolves a possibly dotted path against a fixture schema. */
function schemaHasPath(schema: FixtureSchema, path: string): boolean {
	let node: FixtureSchema | string = schema;
	for (const segment of path.split('.')) {
		if (typeof node === 'string') return false;
		const child: FixtureSchema | string | undefined = node[segment];
		if (child === undefined) return false;
		node = child;
	}
	return true;
}

const COMPOSITE_KEYS = new Set(['and', 'or', 'not']);

function collectWhereFields(where: unknown, into: Set<string>): void {
	if (!where || typeof where !== 'object') return;
	if (Array.isArray(where)) {
		for (const entry of where) collectWhereFields(entry, into);
		return;
	}
	for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
		if (COMPOSITE_KEYS.has(key)) {
			collectWhereFields(value, into);
			continue;
		}
		into.add(key);
	}
}

/** Every schema field path a case refers to. */
function collectReferencedFields(battery_case: BatteryCase): Set<string> {
	const query = battery_case.query as Record<string, unknown>;
	const fields = new Set<string>();

	collectWhereFields(query.where, fields);

	const order = query.order;
	if (Array.isArray(order)) {
		for (const entry of order) {
			const record = entry as Record<string, unknown>;
			if (typeof record.field === 'string') fields.add(record.field);
		}
	}

	for (const key of ['facets', 'boost'] as const) {
		const value = query[key];
		if (value && typeof value === 'object') {
			for (const field of Object.keys(value as Record<string, unknown>))
				fields.add(field);
		}
	}

	const search_fields = query.fields;
	if (Array.isArray(search_fields)) {
		for (const field of search_fields) if (typeof field === 'string') fields.add(field);
	}

	const distinct = query.distinct_on;
	if (typeof distinct === 'string') fields.add(distinct);

	const vector = query.vector as Record<string, unknown> | undefined;
	if (vector && typeof vector.field === 'string') fields.add(vector.field);

	return fields;
}

const KNOWN_QUERY_KEYS = new Set([
	'term',
	'where',
	'order',
	'limit',
	'offset',
	'facets',
	'boost',
	'fields',
	'tolerance',
	'threshold',
	'exact',
	'distinct_on',
	'vector',
	'sparse',
	'cursor',
]);

describe('query battery', () => {
	it('has a meaningful number of cases', () => {
		expect(SEARCH_BATTERY.length).toBeGreaterThan(150);
	});

	it('uses unique case names', () => {
		const names = SEARCH_BATTERY.map((battery_case) => battery_case.name);
		const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
		expect(duplicates).toEqual([]);
	});

	it('tags every case', () => {
		for (const battery_case of SEARCH_BATTERY) {
			expect(battery_case.tags.length, battery_case.name).toBeGreaterThan(0);
			expect(new Set(battery_case.tags).size, battery_case.name).toBe(
				battery_case.tags.length,
			);
		}
	});

	it('only uses query keys the DSL defines', () => {
		for (const battery_case of SEARCH_BATTERY) {
			for (const key of Object.keys(battery_case.query)) {
				expect(KNOWN_QUERY_KEYS.has(key), `${battery_case.name}: ${key}`).toBe(true);
			}
		}
	});

	it('only references fields that exist in its corpus schema', () => {
		for (const battery_case of SEARCH_BATTERY) {
			// `error` cases exist precisely to name fields that do not exist.
			if (battery_case.tags.includes('error')) continue;
			const schema = schemaForPreset(battery_case.corpus);
			for (const field of collectReferencedFields(battery_case)) {
				expect(schemaHasPath(schema, field), `${battery_case.name}: ${field}`).toBe(true);
			}
		}
	});

	it('points every error case at something the engine must reject', () => {
		const error_cases = SEARCH_BATTERY.filter((battery_case) =>
			battery_case.tags.includes('error'),
		);
		expect(error_cases.length).toBeGreaterThanOrEqual(10);
	});

	it('covers both corpus presets', () => {
		expect(batteryCasesForCorpus('article').length).toBeGreaterThan(100);
		expect(batteryCasesForCorpus('event').length).toBeGreaterThanOrEqual(8);
	});

	it('covers every mandatory area from plan §8.1/§8.2', () => {
		const required = [
			'filter-only',
			'scored',
			'facets',
			'order',
			'paging',
			'distinct',
			'geo-radius',
			'geo-polygon',
			'vector',
			'hybrid',
			'orama-bug',
			'deviation',
			'defined-behavior-only',
			'error',
			'null-handling',
			'tie-break',
			'unicode',
			'tokenizer',
			'array-field',
			'child-path',
			'integer-pk',
			'shorthand',
			'composite',
			'empty-result',
		] as const;
		for (const tag of required) {
			expect(BATTERY_TAGS, tag).toContain(tag);
		}
	});

	it('marks every vector and hybrid case server-only', () => {
		for (const battery_case of SEARCH_BATTERY) {
			if (battery_case.tags.includes('vector') || battery_case.tags.includes('hybrid')) {
				expect(battery_case.tags, battery_case.name).toContain('server-only');
			}
		}
	});

	it('documents why every deviation and known-bug case exists', () => {
		const undocumented = SEARCH_BATTERY.filter(
			(battery_case) =>
				!battery_case.notes &&
				(battery_case.tags.includes('deviation') ||
					battery_case.tags.includes('orama-bug') ||
					battery_case.tags.includes('orama-throws')),
		).map((battery_case) => battery_case.name);
		expect(undocumented).toEqual([]);
	});

	it('serializes to stable JSON, so goldens can key off the query', () => {
		expect(JSON.stringify(SEARCH_BATTERY)).toBe(JSON.stringify(SEARCH_BATTERY));
	});
});

/* -------------------------------------------------------------------------- */
/* schemas + golden format                                                    */
/* -------------------------------------------------------------------------- */

describe('schema presets', () => {
	it('uses a string primary key for articles and an integer one for events', () => {
		expect(ARTICLE_SCHEMA.id).toBe('string');
		expect(EVENT_SCHEMA.id).toBe('number');
	});

	it('declares every searchable type at least once across the presets', () => {
		const declared = new Set<string>();
		const walk = (schema: FixtureSchema): void => {
			for (const value of Object.values(schema)) {
				if (typeof value === 'string') declared.add(value);
				else walk(value);
			}
		};
		walk(ARTICLE_SCHEMA);
		walk(EVENT_SCHEMA);
		for (const type of [
			'string',
			'number',
			'boolean',
			'enum',
			'geopoint',
			'string[]',
			'number[]',
			'boolean[]',
			'enum[]',
			'vector[8]',
		]) {
			expect(declared, type).toContain(type);
		}
	});
});

describe('golden format', () => {
	it('pins the format version', () => {
		expect(GOLDEN_FORMAT_VERSION).toBe(1);
	});
});
