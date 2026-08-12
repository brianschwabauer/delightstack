import type { FacetDefinition } from './search/core/types';

/**
 * Non-generic search query type for the encode/decode layer.
 * Structurally compatible with `Database.SearchQuery<Table>` but uses loose types
 * for fields that would otherwise require the Table generic.
 *
 * Use `Database.SearchQuery<Table>` when you have the table type available for full autocomplete.
 */
export interface SearchQueryInput {
	/** The search term */
	term?: string;
	/** Maximum number of results to return */
	limit?: number;
	/** Number of results to skip */
	offset?: number;
	/** Filter conditions */
	where?: Record<string, unknown>;
	/** Facet configuration */
	facets?: Record<string, FacetDefinition>;
	/** Boost configuration for specific fields */
	boost?: Record<string, number>;
	/** Return distinct results based on this field */
	distinct_on?: string;
	/** Whether to match the term exactly */
	exact?: boolean;
	/** Which fields to search in. Use `'*'` for all. */
	fields?: string[] | '*';
	/**
	 * Controls how multi-token terms are combined.
	 *
	 * `0` returns only documents matching *every* token; `1` (the default)
	 * returns every document matching *any* token; a fractional value returns
	 * all-token matches plus that top fraction (by score) of the partial
	 * matches.
	 */
	threshold?: number;
	/** Maximum levenshtein distance tolerance */
	tolerance?: number;
	/**
	 * Vector search configuration (server-only).
	 *
	 * `similarity` is the inclusive minimum cosine similarity a document must
	 * reach; it rides inside the same `vector` JSON URL param.
	 * @default similarity 0.8
	 */
	vector?: { value: number[]; field: string; similarity?: number };
	/**
	 * Whether only sparse searchable fields should be returned.
	 * @default true
	 */
	sparse?: boolean;
	/** Cursor for pagination (from a previous query result) */
	cursor?: string;
	/** Sort order. Multiple orderings determine sorting precedence. */
	order?: { field: string; direction?: 'ASC' | 'DESC' }[];
}

/** Parse a boolean from a URL search param value with tolerance for multiple formats. */
function parseBool(params: URLSearchParams, key: string): boolean | undefined {
	if (!params.has(key)) return undefined;
	const value = params.get(key);
	// ?key (present with no value or empty string) → true
	if (value === null || value === '') return true;
	// ?key=false or ?key=0 → false
	if (value === 'false' || value === '0') return false;
	// ?key=true or ?key=1 or anything else → true
	return true;
}

/** Parse a JSON value from a URL search param, returning undefined on failure. */
function parseJson(params: URLSearchParams, key: string): unknown {
	const value = params.get(key);
	if (value === null) return undefined;
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

/** Parse a numeric value from a URL search param. */
function parseNumber(params: URLSearchParams, key: string): number | undefined {
	const value = params.get(key);
	if (value === null) return undefined;
	const num = Number(value);
	return Number.isNaN(num) ? undefined : num;
}

/**
 * Encode a search query into URL search params.
 *
 * @example
 * ```ts
 * const params = encodeSearchQuery({ term: 'hello', limit: 10, sparse: true });
 * // → "term=hello&limit=10&sparse=true"
 * ```
 */
export function encodeSearchQuery(query: SearchQueryInput): URLSearchParams {
	const params = new URLSearchParams();

	// String scalars
	if (query.term !== undefined) params.set('term', query.term);
	if (query.cursor !== undefined) params.set('cursor', query.cursor);
	if (query.distinct_on !== undefined) params.set('distinct_on', query.distinct_on);

	// Numeric scalars
	if (query.limit !== undefined) params.set('limit', String(query.limit));
	if (query.offset !== undefined) params.set('offset', String(query.offset));
	if (query.threshold !== undefined) params.set('threshold', String(query.threshold));
	if (query.tolerance !== undefined) params.set('tolerance', String(query.tolerance));

	// Booleans
	if (query.sparse !== undefined) params.set('sparse', String(query.sparse));
	if (query.exact !== undefined) params.set('exact', String(query.exact));

	// JSON objects
	if (query.where !== undefined) params.set('where', JSON.stringify(query.where));
	if (query.facets !== undefined) params.set('facets', JSON.stringify(query.facets));
	if (query.boost !== undefined) params.set('boost', JSON.stringify(query.boost));
	if (query.vector !== undefined) params.set('vector', JSON.stringify(query.vector));

	// Fields: comma-separated or '*'
	if (query.fields !== undefined) {
		params.set(
			'fields',
			Array.isArray(query.fields) ? query.fields.join(',') : query.fields,
		);
	}

	// Order: pipe-separated field:direction pairs
	if (query.order?.length) {
		params.set(
			'order',
			query.order.map((o) => `${o.field}:${o.direction ?? 'ASC'}`).join('|'),
		);
	}

	return params;
}

/**
 * Decode URL search params into a search query.
 *
 * Only the canonical key spellings are read (decided 2026-08-12): there are no
 * legacy read aliases, so `q`, `distinctOn`, `properties` and `vector.property`
 * from pre-rename URLs are ignored.
 *
 * @example
 * ```ts
 * const query = decodeSearchQuery(url.searchParams);
 * const results = db.list('post', query);
 * ```
 */
export function decodeSearchQuery(params: URLSearchParams): SearchQueryInput {
	const query: SearchQueryInput = {};

	// String scalars
	const term = params.get('term');
	if (term !== null) query.term = term;

	const cursor = params.get('cursor');
	if (cursor !== null) query.cursor = cursor;

	const distinct_on = params.get('distinct_on');
	if (distinct_on !== null) query.distinct_on = distinct_on;

	// Numeric scalars
	const limit = parseNumber(params, 'limit');
	if (limit !== undefined) query.limit = limit;

	const offset = parseNumber(params, 'offset');
	if (offset !== undefined) query.offset = offset;

	const threshold = parseNumber(params, 'threshold');
	if (threshold !== undefined) query.threshold = threshold;

	const tolerance = parseNumber(params, 'tolerance');
	if (tolerance !== undefined) query.tolerance = tolerance;

	// Booleans
	const sparse = parseBool(params, 'sparse');
	if (sparse !== undefined) query.sparse = sparse;

	const exact = parseBool(params, 'exact');
	if (exact !== undefined) query.exact = exact;

	// JSON objects
	const where = parseJson(params, 'where');
	if (where !== undefined) query.where = where as Record<string, unknown>;

	const facets = parseJson(params, 'facets');
	if (facets !== undefined) query.facets = facets as Record<string, FacetDefinition>;

	const boost = parseJson(params, 'boost');
	if (boost !== undefined) query.boost = boost as Record<string, number>;

	// Vector: `{ value, field, similarity? }` — `similarity` rides along for free
	const vector = parseJson(params, 'vector');
	if (vector !== undefined) {
		query.vector = vector as { value: number[]; field: string; similarity?: number };
	}

	// Fields: comma-separated or '*'
	const fields = params.get('fields');
	if (fields !== null) {
		query.fields = fields === '*' ? '*' : fields.split(',').filter(Boolean);
	}

	// Order: field:direction pairs separated by '|' (canonical) or ',' (hand-written URLs)
	const order = params.get('order');
	if (order !== null) {
		query.order = order
			.split(/[|,]/)
			.filter(Boolean)
			.map((segment) => {
				const [field, direction] = segment.split(':');
				return {
					field,
					direction: (direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC') as
						| 'ASC'
						| 'DESC',
				};
			});
	}

	return query;
}

/**
 * Normalize where-clause shorthands to the operation objects Orama requires.
 *
 * Orama's filter grammar is inconsistent across property types: `string`
 * (Radix) and `boolean` accept plain values, but `enum` (Flat) and `number`
 * (AVL) require an operation object — a bare `where: { folder: 'inbox' }` on
 * an enum throws INVALID_FILTER_OPERATION (Object.keys('inbox') reads the
 * string's indices as "operations"), which surfaced to API callers as a 500.
 *
 * Callers may still pass explicit operators; only primitives and arrays on
 * enum/number properties are rewritten. `and`/`or`/`not` composites are
 * normalized recursively. Unknown properties are left untouched — Orama's
 * UNKNOWN_FILTER_PROPERTY handles those.
 *
 * Operator spellings are the canonical ones only (`contains_all`,
 * `contains_any`, `not_in`); the pre-rename spellings are not accepted
 * (decided 2026-08-12 — no legacy read aliases).
 */
export function normalizeWhere(
	where: Record<string, unknown> | undefined,
	schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!where || typeof where !== 'object' || !schema) return where;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(where)) {
		if (key === 'and' || key === 'or') {
			out[key] = Array.isArray(value)
				? value.map((v) => normalizeWhere(v as Record<string, unknown>, schema))
				: value;
			continue;
		}
		if (key === 'not') {
			out[key] = normalizeWhere(value as Record<string, unknown>, schema);
			continue;
		}
		const type = schema[key];
		if (type === 'enum') {
			if (typeof value === 'string' || typeof value === 'number') {
				out[key] = { eq: value };
				continue;
			}
			if (Array.isArray(value)) {
				out[key] = { in: value };
				continue;
			}
		}
		if (type === 'number' && typeof value === 'number') {
			out[key] = { eq: value };
			continue;
		}
		out[key] = value;
	}
	return out;
}
