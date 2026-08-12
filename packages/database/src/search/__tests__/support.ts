/**
 * Shared wiring between the fixture modules and the engine.
 *
 * `fixtures/corpus.ts` and `fixtures/battery.ts` are deliberately standalone —
 * they mirror `core/types.ts` rather than importing it, so they could be
 * written before `core/*` existed. This module is where the two halves are
 * finally bolted together: it flattens a nested fixture schema into the flat
 * dot-path map the engine's `WhereSchema` wants, builds a loaded
 * `MemorySearchEngine` from a corpus, and (for the differential harness)
 * projects a corpus document into the null-stripped shape production actually
 * indexes.
 *
 * Consumed by `differential.test.ts` (plan §8.1), `golden/generate.ts` and
 * `golden.test.ts` (plan §8.2).
 */

import { MemorySearchEngine } from '../memory/engine';
import type { SearchQuery } from '../core/types';
import type { WhereSchema } from '../core/where';
import type { FixtureSearchQuery } from './fixtures/battery';
import {
	generateCorpus,
	type Corpus,
	type CorpusPresetName,
	type CorpusSizeName,
	type FixtureSchema,
} from './fixtures/corpus';

/* -------------------------------------------------------------------------- */
/* Static drift guard                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The fixtures' mirror query type must stay a subset of the engine's real one.
 *
 * If a key is renamed in `core/types.ts` without the battery following, this
 * line stops compiling — which is the whole point of writing the battery in the
 * owned DSL.
 */
type FixtureQueryKeysExistOnEngineQuery =
	keyof FixtureSearchQuery extends keyof SearchQuery<unknown> ? true : never;
const QUERY_KEY_DRIFT_GUARD: FixtureQueryKeysExistOnEngineQuery = true;
export { QUERY_KEY_DRIFT_GUARD };

/* -------------------------------------------------------------------------- */
/* Schema + document projection                                               */
/* -------------------------------------------------------------------------- */

/**
 * Flattens a nested fixture schema into the flat `dot.path → type` map the
 * engine treats as its closed set of legal paths.
 *
 * Only leaves appear: `address: { city: 'string' }` becomes `'address.city'`,
 * never `'address'`.
 */
export function flattenSchema(schema: FixtureSchema, prefix = ''): WhereSchema {
	const flat: WhereSchema = {};
	for (const key of Object.keys(schema)) {
		const value = schema[key];
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'string') flat[path] = value;
		else Object.assign(flat, flattenSchema(value, path));
	}
	return flat;
}

/* -------------------------------------------------------------------------- */
/* Engine construction                                                        */
/* -------------------------------------------------------------------------- */

/** A corpus plus the engine holding it — every harness starts from one of these. */
export interface LoadedCorpus {
	corpus: Corpus;
	engine: MemorySearchEngine;
	schema: WhereSchema;
}

/** Builds a memory reference engine loaded with every document in `corpus`. */
export function buildMemoryEngine(corpus: Corpus): MemorySearchEngine {
	const engine = new MemorySearchEngine({
		schema: flattenSchema(corpus.schema),
		primary_key: corpus.primary_key,
		primary_key_type: corpus.primary_key_type,
	});
	engine.insertMany(corpus.docs);
	return engine;
}

/** Generates a corpus and loads it into a memory reference engine. */
export function loadCorpus(
	preset: CorpusPresetName,
	size: CorpusSizeName,
	seed: string = `${preset}-${size}`,
): LoadedCorpus {
	const corpus = generateCorpus({ preset, size, seed });
	return {
		corpus,
		engine: buildMemoryEngine(corpus),
		schema: flattenSchema(corpus.schema),
	};
}

/**
 * Casts a battery case's query to the engine's query type.
 *
 * The battery's `where` is deliberately `Record<string, unknown>` — it contains
 * operand shapes that are *invalid* for their field type (the `error` cases),
 * which the typed `WhereCondition` cannot express. One localized cast, here.
 */
export function toEngineQuery(query: FixtureSearchQuery): SearchQuery {
	return query as SearchQuery;
}
