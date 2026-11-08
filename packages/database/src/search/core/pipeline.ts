/**
 * The shared pipeline tail: validation, threshold, ordering, `distinct_on`.
 *
 * Every semantic decision about membership, order or a count is made HERE, once
 * — the three drivers (memory reference, DO-SQLite server, IndexedDB client)
 * only orchestrate storage around these functions, which is what makes the
 * golden vectors byte-identical across them (§3's consistency contract).
 */

import { DelightError } from '@delightstack/utilities';
import {
	compareForOrder,
	comparePrimaryKeys,
	compareStrings,
	type PrimaryKeyType,
} from './compare.js';
import {
	highlightDocument,
	type HighlightOption,
	type MatchedTokens,
	rerankByProximity,
} from './proximity.js';
import { isTextFieldType } from './schema_fields.js';
import type { TokenHits } from './token_hits.js';
import { DEFAULT_MAX_FIELD_TOKENS } from './tokenizer.js';
import type { SearchQuery } from './types.js';
import { getFieldValue, type WhereSchema } from './where.js';

/** The structural configuration the pipeline needs — every driver satisfies it. */
export interface PipelineConfig {
	/** Flat map of dot-path → declared type. The closed set of legal paths. */
	schema: WhereSchema;
	/** The document's primary-key field. */
	primary_key: string;
	/** How primary keys compare in tie-breaks. */
	primary_key_type: PrimaryKeyType;
	/** Searchable text fields, ascending — the deterministic accumulation order. */
	text_fields: readonly string[];
	/** Per-field `.searchable({ weight, max_tokens })` options. */
	field_options?: Readonly<Record<string, { weight?: number; max_tokens?: number }>>;
}

/** A document plus the score it earned. `doc_id` is `String(primary_key)`. */
export interface ScoredDocument {
	doc_id: string;
	primary_key: string | number;
	document: Record<string, unknown>;
	score: number;
}

/** `elapsed`, from a caller-supplied clock only (§3 determinism rules). */
export function elapsedSince(
	started: number,
	now: (() => number) | undefined,
): { raw: number; formatted: string } {
	const raw = now ? now() - started : 0;
	return { raw, formatted: `${raw}ms` };
}

/** Resolve and validate `fields` into the searched text fields, ascending. */
export function resolveSearchFields(
	config: PipelineConfig,
	query: SearchQuery,
): string[] {
	const fields = query.fields;
	if (!fields || fields === '*') return [...config.text_fields];
	if (!Array.isArray(fields)) {
		throw DelightError.badRequest('`fields` must be `"*"` or an array of field names.', {
			code: 'invalid_search_field',
		});
	}
	const resolved: string[] = [];
	for (const field of fields) {
		const type = config.schema[field];
		if (type === undefined) {
			throw DelightError.badRequest(`Unknown search field "${field}".`, {
				code: 'unknown_search_field',
			});
		}
		if (!isTextFieldType(type)) {
			throw DelightError.badRequest(
				`Field "${field}" is a ${type} — only string fields can be searched.`,
				{ code: 'invalid_search_field' },
			);
		}
		resolved.push(field);
	}
	return [...new Set(resolved)].sort(compareStrings);
}

/**
 * `highlight` must be a boolean or `{ fields?, length? }` naming searched
 * fields and a positive length. It arrives from a URL as arbitrary JSON, so
 * it is checked here once, identically for every driver.
 */
export function validateHighlight(query: SearchQuery, search_fields: readonly string[]): void {
	const option = query.highlight as unknown;
	if (option === undefined || typeof option === 'boolean') return;
	const fail = (message: string) =>
		DelightError.badRequest(message, { code: 'invalid_highlight' });
	if (!option || typeof option !== 'object' || Array.isArray(option)) {
		throw fail('`highlight` must be true, false or { fields, length }.');
	}
	const { fields, length } = option as { fields?: unknown; length?: unknown };
	if (fields !== undefined) {
		if (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string')) {
			throw fail('`highlight.fields` must be an array of field names.');
		}
		for (const field of fields as string[]) {
			if (!search_fields.includes(field)) {
				throw fail(`\`highlight.fields\` names "${field}", which this query does not search.`);
			}
		}
	}
	if (
		length !== undefined &&
		!(typeof length === 'number' && Number.isFinite(length) && length > 0)
	) {
		throw fail('`highlight.length` must be a positive number.');
	}
}

/** Every `order[].field` must be a declared field or the primary key. */
export function validateOrder(config: PipelineConfig, query: SearchQuery): void {
	for (const instruction of query.order ?? []) {
		const field = instruction.field;
		if (field !== config.primary_key && config.schema[field] === undefined) {
			throw DelightError.badRequest(`Unknown order field "${field}".`, {
				code: 'unknown_order_field',
			});
		}
	}
}

/** `distinct_on` must name a declared field or the primary key. */
export function validateDistinctOn(config: PipelineConfig, query: SearchQuery): void {
	const field = query.distinct_on;
	if (field === undefined) return;
	if (field !== config.primary_key && config.schema[field] === undefined) {
		throw DelightError.badRequest(`Unknown distinct_on field "${field}".`, {
			code: 'unknown_distinct_field',
		});
	}
}

/**
 * Apply `threshold` (§4.5) with per-DOCUMENT "all tokens" semantics.
 *
 * `U` = documents matching at least one query token; `A ⊆ U` = documents
 * matching every distinct query token anywhere in the searched fields.
 * `0` → `A`; `1` (the default) → `U`; `0 < t < 1` → `A` plus the top
 * `ceil(|U \ A| * t)` of the remainder by score.
 *
 * The remainder's tie-break compares doc ids directly: a doc id is
 * `String(primary_key)` by construction, and `comparePrimaryKeys` coerces both
 * forms identically, so the order equals comparing the typed keys themselves.
 */
export function applyThreshold(
	config: PipelineConfig,
	text_scores: ReadonlyMap<string, number>,
	token_hits: TokenHits,
	token_count: number,
	threshold: number | undefined,
): Set<string> {
	// NOT sorted: every branch below turns `union` into a `Set` or re-sorts it
	// with a *total* comparator (score, then primary key), so the walk order is
	// unobservable — and sorting tens of thousands of matched ids to then throw
	// the order away was pure cost. The caller sorts the ids it keeps.
	const union = token_hits.ids();
	const all_match = new Set(union.filter((id) => token_hits.size(id) >= token_count));
	const value = threshold ?? 1;
	if (value >= 1) return new Set(union);
	if (value <= 0) return all_match;
	const remainder = union.filter((id) => !all_match.has(id));
	remainder.sort((a, b) => {
		const score_a = text_scores.get(a) ?? 0;
		const score_b = text_scores.get(b) ?? 0;
		if (score_a !== score_b) return score_a > score_b ? -1 : 1;
		return comparePrimaryKeys(a, b, config.primary_key_type);
	});
	const keep = Math.ceil(remainder.length * value);
	const result = new Set(all_match);
	for (const id of remainder.slice(0, keep)) result.add(id);
	return result;
}

/**
 * Order results: by `order[]` when given, else by score descending when the
 * query scored anything, else by primary key ascending. Every path ends with a
 * primary-key ascending tie-break.
 */
export function applyOrder(
	config: PipelineConfig,
	results: ScoredDocument[],
	query: SearchQuery,
	is_scored: boolean,
): void {
	const order = query.order ?? [];
	results.sort((a, b) => {
		for (const instruction of order) {
			const comparison = compareForOrder(
				getFieldValue(a.document, instruction.field),
				getFieldValue(b.document, instruction.field),
				instruction.direction ?? 'ASC',
			);
			if (comparison !== 0) return comparison;
		}
		if (order.length === 0 && is_scored && a.score !== b.score) {
			return a.score > b.score ? -1 : 1;
		}
		return comparePrimaryKeys(a.primary_key, b.primary_key, config.primary_key_type);
	});
}

/**
 * Keep the first result per distinct value of `distinct_on`, after ordering.
 *
 * Missing/null values form a single group like any other value, so at most one
 * document lacking the field survives.
 */
export function applyDistinct(
	results: ScoredDocument[],
	field: string | undefined,
): ScoredDocument[] {
	if (!field) return results;
	const seen = new Set<string>();
	const kept: ScoredDocument[] = [];
	for (const entry of results) {
		const value = getFieldValue(entry.document, field);
		// Type-prefixed so `1` and `'1'` never collapse into one group.
		const key =
			value === null || value === undefined ? 'null' : `${typeof value}:${String(value)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(entry);
	}
	return kept;
}

/**
 * The proximity pass (`core/proximity`) over score-ordered results, in place.
 * Runs only when results are ranked by score (no `order[]`) and the term has
 * at least two words; every driver calls it after {@link applyOrder} and
 * before {@link applyDistinct}.
 */
export function applyProximity(
	config: PipelineConfig,
	results: ScoredDocument[],
	query: SearchQuery,
	search_fields: readonly string[],
	ordered_tokens: readonly string[],
	matched: MatchedTokens,
	multi_match: ReadonlySet<string>,
): void {
	if ((query.order?.length ?? 0) > 0 || ordered_tokens.length < 2) return;
	rerankByProximity(
		results,
		(entry) => entry.document,
		search_fields,
		ordered_tokens,
		matched,
		(field) => config.field_options?.[field]?.max_tokens ?? DEFAULT_MAX_FIELD_TOKENS,
		config.primary_key_type,
		multi_match,
	);
}

/** Documents that matched at least two distinct query tokens (proximity candidates). */
export function multiMatchIds(token_hits: TokenHits, token_count: number): Set<string> {
	if (token_count < 2) return new Set();
	return new Set(token_hits.ids().filter((doc_id) => token_hits.size(doc_id) >= 2));
}

/** Attach `highlights` to page hits when the query asked for them. */
export function withHighlights<Hit extends { document: Record<string, unknown> }>(
	hits: Hit[],
	query: SearchQuery,
	search_fields: readonly string[],
	matched: MatchedTokens,
): Hit[] {
	const option = query.highlight as HighlightOption | undefined;
	if (!option || matched.size === 0) return hits;
	return hits.map((hit) => {
		const highlights = highlightDocument(hit.document, search_fields, matched, option);
		return highlights ? { ...hit, highlights } : hit;
	});
}
