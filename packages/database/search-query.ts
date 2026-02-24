import type { FacetDefinition } from '@orama/orama';

/**
 * Non-generic search query type for the encode/decode layer.
 * Structurally compatible with `Database.SearchQuery<Table>` but uses loose types
 * for Orama-specific fields that would otherwise require the Table generic.
 *
 * Use `Database.SearchQuery<Table>` when you have the table type available for full autocomplete.
 */
export interface SearchQueryInput {
	/** Alias for `term`. If both are provided, `term` takes precedence. */
	q?: string;
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
	/** Boost configuration for specific properties */
	boost?: Record<string, number>;
	/** Return distinct results based on this property */
	distinctOn?: string;
	/** Whether to match the term exactly */
	exact?: boolean;
	/** Which properties to search in. Use `'*'` for all. */
	properties?: string[] | '*';
	/** Minimum relevance threshold (0-1) */
	threshold?: number;
	/** Maximum levenshtein distance tolerance */
	tolerance?: number;
	/** Vector search configuration */
	vector?: { value: number[]; property: string };
	/**
	 * Whether only sparse searchable fields should be returned.
	 * @default true
	 */
	sparse?: boolean;
	/** Cursor for pagination (from a previous query result) */
	cursor?: string;
	/** Sort order. Multiple orderings determine sorting precedence. */
	order?: { key: string; direction?: 'ASC' | 'DESC' }[];
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
	if (query.q !== undefined) params.set('q', query.q);
	if (query.cursor !== undefined) params.set('cursor', query.cursor);
	if (query.distinctOn !== undefined) params.set('distinct_on', query.distinctOn);

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

	// Properties: comma-separated or '*'
	if (query.properties !== undefined) {
		params.set(
			'properties',
			Array.isArray(query.properties) ? query.properties.join(',') : query.properties,
		);
	}

	// Order: pipe-separated key:direction pairs
	if (query.order?.length) {
		params.set(
			'order',
			query.order.map((o) => `${o.key}:${o.direction ?? 'ASC'}`).join('|'),
		);
	}

	return params;
}

/**
 * Decode URL search params into a search query.
 * `q` is treated as an alias for `term` — if both are present, `term` takes precedence.
 *
 * @example
 * ```ts
 * const query = decodeSearchQuery(url.searchParams);
 * const results = db.list('post', query);
 * ```
 */
export function decodeSearchQuery(params: URLSearchParams): SearchQueryInput {
	const query: SearchQueryInput = {};

	// Term: 'term' takes precedence over 'q'
	const term = params.get('term');
	const q = params.get('q');
	if (term !== null) {
		query.term = term;
	} else if (q !== null) {
		query.term = q;
	}

	// String scalars
	const cursor = params.get('cursor');
	if (cursor !== null) query.cursor = cursor;

	const distinct_on = params.get('distinct_on');
	if (distinct_on !== null) query.distinctOn = distinct_on;

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

	const vector = parseJson(params, 'vector');
	if (vector !== undefined) query.vector = vector as { value: number[]; property: string };

	// Properties: comma-separated or '*'
	const properties = params.get('properties');
	if (properties !== null) {
		query.properties = properties === '*' ? '*' : properties.split(',').filter(Boolean);
	}

	// Order: pipe-separated key:direction pairs
	const order = params.get('order');
	if (order !== null) {
		query.order = order
			.split('|')
			.filter(Boolean)
			.map((segment) => {
				const [key, direction] = segment.split(':');
				return {
					key,
					direction: (direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC') as
						| 'ASC'
						| 'DESC',
				};
			});
	}

	return query;
}
