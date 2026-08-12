/**
 * The Orama side of the differential harness (plan §8.1).
 *
 * **Test-only, and temporary.** This module exists to prove that the native
 * engine agrees with Orama 3.1.16 everywhere the frozen spec says it should,
 * and diverges *only* where `plans/database/orama-verification-report.md` says
 * it deliberately does. It retires with `@orama/orama` in Phase 5.
 *
 * It runs Orama with the same guards production runs it with today:
 * - documents are null-stripped exactly as `table.toSparse()` strips them
 *   (`support.ts:toSparseDocument`), because a null array property makes
 *   Orama's `remove()` throw;
 * - hits whose document is missing the primary key are dropped as ghost
 *   documents (`db.server.ts:list`), and `count` is reduced by the number
 *   dropped;
 * - `properties` defaults to `'*'` and `mode` is set explicitly, as
 *   `db.server.ts` does.
 *
 * Two accommodations are forced by Orama itself, not chosen:
 *
 * 1. **Orama has no integer primary key.** `insert` throws
 *    `Document id must be of type "string"` for a numeric `id`, so the `event`
 *    corpus is handed to Orama with `id: String(id)` and a `'string'` schema
 *    entry. Integer-PK *ordering* is therefore not comparable against Orama at
 *    all — it is covered by the golden vectors instead (plan §8.2).
 * 2. **Orama has no multi-key `order`.** Its `sortBy` takes a single property
 *    (or an opaque comparator) and has no tie-break, so `order[]` is dropped
 *    from the Orama query and result *order* is never compared. Membership,
 *    counts and facets are.
 */

import { create, insertMultiple, search } from '@orama/orama';
import type { AnyOrama, Results } from '@orama/orama';
import { toOramaSearchParams } from '../orama-compat';
import type { FixtureSearchQuery } from './fixtures/battery';
import type { Corpus, FixtureSchema } from './fixtures/corpus';
import { toSparseDocument } from './support';

/** Orama's default `limit` is 10 — every harness query overrides it. */
const UNLIMITED = 1_000_000;

/** What the harness compares against the native engine. */
export interface OramaResult {
	/** Primary keys of the surviving hits, in Orama's result order. */
	ids: string[];
	/** `Results.count`, reduced by the ghost documents that were dropped. */
	count: number;
	/** Facet counts, when the query requested facets. */
	facets?: Record<string, { count: number; values: Record<string, number> }>;
}

/** A corpus loaded into a real Orama index. */
export interface OramaReference {
	/** Runs one battery query and returns the guarded result. */
	search(query: FixtureSearchQuery): OramaResult;
	/** How many documents were inserted. */
	size: number;
}

/**
 * Rewrites the schema Orama gets: the primary key is always `'string'`, because
 * Orama refuses any other document id type.
 */
function toOramaSchema(schema: FixtureSchema, primary_key: string): FixtureSchema {
	return { ...schema, [primary_key]: 'string' };
}

/** Builds and loads a real Orama index from a fixture corpus. */
export function createOramaReference(corpus: Corpus): OramaReference {
	const primary_key = corpus.primary_key;
	const db = create({
		schema: toOramaSchema(corpus.schema, primary_key) as never,
	}) as AnyOrama;

	const documents = corpus.docs.map((doc) => {
		const sparse = toSparseDocument(doc);
		return { ...sparse, [primary_key]: String(sparse[primary_key]) };
	});
	insertMultiple(db, documents as never[]);

	return {
		size: documents.length,
		search(query) {
			const translated = toOramaSearchParams(query as unknown as Record<string, unknown>);
			// Keys Orama cannot express or must not see (see the module docblock).
			delete translated.order;
			delete translated.sparse;
			delete translated.cursor;
			const parameters: Record<string, unknown> = {
				...translated,
				term: query.term ?? '',
				properties: translated.properties ?? '*',
				mode: 'fulltext',
				includeVectors: false,
				limit: query.limit ?? UNLIMITED,
			};
			const results = search(db, parameters as never) as Results<Record<string, unknown>>;
			const surviving = results.hits.filter(
				(hit) => hit.document && hit.document[primary_key] !== undefined,
			);
			const dropped_ghosts = results.hits.length - surviving.length;
			return {
				ids: surviving.map((hit) => String(hit.document[primary_key])),
				count: Math.max(0, results.count - dropped_ghosts),
				...(results.facets ? { facets: results.facets } : {}),
			};
		},
	};
}

/**
 * Runs a battery query through Orama, reporting a throw rather than letting it
 * escape — the `orama-throws` cases exist precisely to pin those.
 */
export function tryOrama(
	reference: OramaReference,
	query: FixtureSearchQuery,
): { ok: true; result: OramaResult } | { ok: false; error: Error } {
	try {
		return { ok: true, result: reference.search(query) };
	} catch (error) {
		return { ok: false, error: error as Error };
	}
}
