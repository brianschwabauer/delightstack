/**
 * Engine-neutral search types, owned by `@delightstack/database`.
 *
 * See `plans/database/Native Search Engine Plan.md` §6.
 */

/* -------------------------------------------------------------------------- */
/* Schema primitives                                                          */
/* -------------------------------------------------------------------------- */

/** A vector field declaration, e.g. `vector[768]` */
export type VectorType = `vector[${number}]`;

/** The searchable field types that hold a single value */
export type ScalarSearchableType = 'string' | 'number' | 'boolean' | 'enum' | 'geopoint';

/** The searchable field types that hold a list of values */
export type ArraySearchableType =
	| 'string[]'
	| 'number[]'
	| 'boolean[]'
	| 'enum[]'
	| VectorType;

/** Every field type the search index understands */
export type SearchableType = ScalarSearchableType | ArraySearchableType;

/** A latitude/longitude pair — the value of a `geopoint` field */
export interface GeoPoint {
	lat: number;
	lon: number;
}

/**
 * The shape of a search-index schema: a (possibly nested) map of field name to
 * field type.
 */
export type AnySearchSchema = {
	[key: PropertyKey]: SearchableType | AnySearchSchema;
};

/** Maps a declared field type to the JS value type stored for it */
export type SearchValueType<Value> = Value extends 'string'
	? string
	: Value extends 'string[]'
		? string[]
		: Value extends 'boolean'
			? boolean
			: Value extends 'boolean[]'
				? boolean[]
				: Value extends 'number'
					? number
					: Value extends 'number[]'
						? number[]
						: Value extends 'enum'
							? string | number
							: Value extends 'enum[]'
								? (string | number)[]
								: Value extends 'geopoint'
									? GeoPoint
									: Value extends VectorType
										? number[]
										: Value extends object
											? {
													[Key in keyof Value]: SearchValueType<Value[Key]>;
												} & {
													// Index signature preserved so consumers can
													// still read arbitrary keys off an indexed
													// document.
													[otherKeys: PropertyKey]: any;
												}
											: never;

/** The document shape produced by indexing an entity under `TSchema` */
export type IndexedDocument<TSchema> = TSchema extends AnySearchSchema
	? {
			id: string | number;
		} & {
			-readonly [Key in keyof TSchema]: SearchValueType<TSchema[Key]>;
		} & {
			[otherKeys: PropertyKey]: any;
		}
	: never;

/**
 * A union of the schema's own keys plus any string — keeps autocomplete for
 * declared fields without rejecting dot-notation child paths.
 */
export type SearchFieldName<TSchema> =
	| (keyof TSchema & string)
	| (string & Record<never, never>);

/* -------------------------------------------------------------------------- */
/* Where DSL                                                                  */
/* -------------------------------------------------------------------------- */

/** Numeric/ordered comparison operators */
export interface ComparisonOperator {
	gt?: number;
	gte?: number;
	lt?: number;
	lte?: number;
	eq?: number;
	between?: [number, number];
}

/** Operators available on scalar `enum` fields */
export interface EnumComparisonOperator {
	eq?: string | number | boolean;
	in?: (string | number | boolean)[];
	/** Value is present AND not in the list (missing/null does not match) */
	not_in?: (string | number | boolean)[];
}

/** Operators available on array (`enum[]`) fields */
export interface EnumArrComparisonOperator {
	/** Every listed value must be present in the array */
	contains_all?: (string | number | boolean)[];
	/** At least one listed value must be present in the array */
	contains_any?: (string | number | boolean)[];
}

/** Distance units accepted by the `radius` geo operator */
export type GeoDistanceUnit = 'cm' | 'm' | 'km' | 'ft' | 'yd' | 'mi';

/** Matches geopoints within (or outside) a radius of a coordinate */
export interface GeoRadiusOperator {
	radius: {
		coordinates: GeoPoint;
		value: number;
		/** @default 'm' */
		unit?: GeoDistanceUnit;
		/** @default true */
		inside?: boolean;
	};
}

/** Matches geopoints inside (or outside) a polygon */
export interface GeoPolygonOperator {
	polygon: {
		coordinates: GeoPoint[];
		/** @default true */
		inside?: boolean;
	};
}

/** Every geo filter shape */
export type GeoOperation = GeoRadiusOperator | GeoPolygonOperator;

/** The filter operand allowed for a given declared field type */
export type WhereOperator<Value> = Value extends 'string'
	? string | string[]
	: Value extends 'string[]'
		? string | string[]
		: Value extends 'boolean'
			? boolean
			: Value extends 'boolean[]'
				? boolean
				: Value extends 'number'
					? ComparisonOperator
					: Value extends 'number[]'
						? ComparisonOperator
						: Value extends 'enum'
							? EnumComparisonOperator
							: Value extends 'enum[]'
								? EnumArrComparisonOperator
								: Value extends 'geopoint'
									? GeoOperation
									: never;

/** The `where` filter DSL, typed against a search schema */
export type WhereCondition<TSchema> =
	| {
			[key in keyof TSchema]?: WhereOperator<TSchema[key]>;
	  }
	| { and?: WhereCondition<TSchema>[] }
	| { or?: WhereCondition<TSchema>[] }
	| { not?: WhereCondition<TSchema> };

/* -------------------------------------------------------------------------- */
/* Facets                                                                     */
/* -------------------------------------------------------------------------- */

/** Facet sort direction */
export type FacetSorting = 'asc' | 'desc';

/** Facet configuration for a string/enum field */
export interface StringFacetDefinition {
	limit?: number;
	offset?: number;
	sort?: FacetSorting;
}

/** Facet configuration for a number field */
export interface NumberFacetDefinition {
	ranges: { from: number; to: number }[];
}

/** Facet configuration for a boolean field — both buckets are always reported */
export type BooleanFacetDefinition = Record<never, never>;

/** Any facet configuration */
export type FacetDefinition =
	| StringFacetDefinition
	| NumberFacetDefinition
	| BooleanFacetDefinition;

/** The `facets` query parameter, typed against a search schema */
export type FacetsParams<TSchema> = Partial<
	Record<SearchFieldName<TSchema>, FacetDefinition>
>;

/** Facet counts returned alongside search results */
export type FacetResult = Record<
	string,
	{
		count: number;
		values: Record<string, number>;
	}
>;

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

/** A single ordering instruction */
export interface SearchOrder<TSchema = unknown> {
	/** The field to sort by */
	field: SearchFieldName<TSchema>;
	/** The direction to sort by @default 'ASC' */
	direction?: 'ASC' | 'DESC';
}

/** Vector-similarity query parameters (server-only) */
export interface SearchVectorQuery<TSchema = unknown> {
	/** The query vector */
	value: number[];
	/** The vector field to compare against */
	field: SearchFieldName<TSchema>;
	/**
	 * The minimum cosine similarity a document must reach to be admitted
	 * (inclusive — a document scoring exactly this value matches). Applies to
	 * both vector and hybrid mode.
	 *
	 * It rides inside the existing `vector` JSON URL param, so encode/decode
	 * carry it for free.
	 *
	 * @default 0.8
	 */
	similarity?: number;
}

/**
 * The engine-neutral search query.
 *
 * `mode` and `sortBy` are deliberately absent — they are derived internally.
 */
export interface SearchQuery<TSchema = unknown> {
	/** The term, sentence, or word to search for */
	term?: string;

	/** Filter conditions applied before scoring */
	where?: Partial<WhereCondition<TSchema>>;

	/** How results should be ordered. Multiple orderings determine precedence. */
	order?: SearchOrder<TSchema>[];

	/** The maximum number of matched documents to return */
	limit?: number;

	/** The number of matched documents to skip */
	offset?: number;

	/** Facet configuration, keyed by field */
	facets?: FacetsParams<TSchema>;

	/** Per-field score multipliers applied during term matching */
	boost?: Partial<Record<SearchFieldName<TSchema>, number>>;

	/** Which fields to search in. Use `'*'` for all. @default '*' */
	fields?: '*' | SearchFieldName<TSchema>[];

	/** The maximum levenshtein distance between the term and an indexed token */
	tolerance?: number;

	/**
	 * Controls how multi-token terms are combined.
	 *
	 * `0` returns only documents matching *every* token; `1` (the default)
	 * returns every document matching *any* token; a fractional value returns
	 * all-token matches plus that top fraction (by score) of the partial
	 * matches.
	 */
	threshold?: number;

	/** Whether to match the term exactly instead of by prefix */
	exact?: boolean;

	/** Keep only the first result per distinct value of this field */
	distinct_on?: SearchFieldName<TSchema>;

	/** Vector-similarity search configuration (server-only) */
	vector?: SearchVectorQuery<TSchema>;

	/**
	 * Whether only the sparse 'searchable' fields should be returned.
	 * If false, all fields from sqlite are returned (including those stored in
	 * the 'json' column).
	 * @default true
	 */
	sparse?: boolean;

	/**
	 * A cursor to continue fetching results from a previous query.
	 * If provided, all other query parameters are ignored.
	 */
	cursor?: string;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

/** How long a search took */
export interface ElapsedTime {
	raw: number;
	formatted: string;
}

/** A single search result */
export interface SearchHit<Document> {
	/** The id of the document */
	id: string;
	/** The score of the document in the search */
	score: number;
	/** The document */
	document: Document;
}

/** The result set returned by a search */
export interface SearchQueryResults<Document> {
	/** The number of all the matched documents */
	count: number;
	/** The matched documents, taking `limit`/`offset` into account */
	hits: SearchHit<Document>[];
	/** The time taken to search */
	elapsed: ElapsedTime;
	/** Facet counts, when facets were requested */
	facets?: FacetResult;
}
