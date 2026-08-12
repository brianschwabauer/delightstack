/**
 * Deterministic corpus generators for the search test infrastructure.
 *
 * Consumed by both the differential harness (plan §8.1, native core vs Orama
 * 3.1.18) and the golden-vector suite (plan §8.2). Everything here is a pure
 * function of a seed — no `Math.random`, no `Date.now`, no I/O.
 *
 * Two schema presets exist because the plan requires integer-primary-key
 * coverage (§8.2: postings store `doc_id` as `String(pk)` while tie-breaks
 * compare as the declared PK type, so `2 < 10` must be exercised, not
 * `'10' < '2'`):
 *
 * - `article` — string PK, the wide preset (every searchable type, nested
 *   `address.*` child paths, geopoint, vector, unicode, arrays).
 * - `event` — integer PK, narrower, focused on tie-breaks and ordering.
 *
 * ## Standalone by design
 *
 * The schema/field-type vocabulary below deliberately *mirrors*
 * `search/core/types.ts` (`SearchableType`, `GeoPoint`, `AnySearchSchema`)
 * rather than importing it: this module has to be usable while `core/*` and
 * `memory/*` are still being written. The names and shapes are identical, so a
 * `FixtureSchema` is assignable to `AnySearchSchema` once the harness wires the
 * two together.
 */

import { createPrng, type Prng } from './prng';

/* -------------------------------------------------------------------------- */
/* Schema vocabulary (mirrors core/types.ts)                                  */
/* -------------------------------------------------------------------------- */

/** Mirror of `core/types.ts` `VectorType`. */
export type FixtureVectorType = `vector[${number}]`;

/** Mirror of `core/types.ts` `SearchableType`. */
export type FixtureFieldType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'enum'
	| 'geopoint'
	| 'string[]'
	| 'number[]'
	| 'boolean[]'
	| 'enum[]'
	| FixtureVectorType;

/** Mirror of `core/types.ts` `AnySearchSchema`. */
export type FixtureSchema = { [key: string]: FixtureFieldType | FixtureSchema };

/** Mirror of `core/types.ts` `GeoPoint`. */
export interface FixtureGeoPoint {
	lat: number;
	lon: number;
}

/** A generated document. Values are loose because edge docs deliberately carry
 * `null`s and omit keys entirely (plan §5 null-vs-absent rule). */
export type FixtureDocument = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Geo helpers (local — core/geo.ts is written by another agent)              */
/* -------------------------------------------------------------------------- */

/** Earth radius used by Orama's BKD tree, verified in the Orama report §8. */
export const EARTH_RADIUS_M = 6371e3;

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Spherical haversine distance in metres, in the exact operand order Orama's
 * `trees/bkd.js` uses (`c = 2 * atan2(sqrt(a), sqrt(1 - a))`).
 *
 * Used here only to *place* boundary documents: a doc placed at
 * `haversineMeters(center, doc) === R` sits exactly on the `inside: true`
 * boundary (`distance <= value`), which is what plan §5.1's "boundary-exact
 * distances" golden coverage needs.
 */
export function haversineMeters(from: FixtureGeoPoint, to: FixtureGeoPoint): number {
	const lat_1 = from.lat * DEGREES_TO_RADIANS;
	const lat_2 = to.lat * DEGREES_TO_RADIANS;
	const delta_lat = (to.lat - from.lat) * DEGREES_TO_RADIANS;
	const delta_lon = (to.lon - from.lon) * DEGREES_TO_RADIANS;
	const a =
		Math.sin(delta_lat / 2) * Math.sin(delta_lat / 2) +
		Math.cos(lat_1) * Math.cos(lat_2) * Math.sin(delta_lon / 2) * Math.sin(delta_lon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return EARTH_RADIUS_M * c;
}

/** The point `distance_m` metres from `origin` along `bearing_degrees`. */
export function destinationPoint(
	origin: FixtureGeoPoint,
	distance_m: number,
	bearing_degrees: number,
): FixtureGeoPoint {
	const angular = distance_m / EARTH_RADIUS_M;
	const bearing = bearing_degrees * DEGREES_TO_RADIANS;
	const lat_1 = origin.lat * DEGREES_TO_RADIANS;
	const lon_1 = origin.lon * DEGREES_TO_RADIANS;
	const lat_2 = Math.asin(
		Math.sin(lat_1) * Math.cos(angular) +
			Math.cos(lat_1) * Math.sin(angular) * Math.cos(bearing),
	);
	const lon_2 =
		lon_1 +
		Math.atan2(
			Math.sin(bearing) * Math.sin(angular) * Math.cos(lat_1),
			Math.cos(angular) - Math.sin(lat_1) * Math.sin(lat_2),
		);
	return { lat: lat_2 / DEGREES_TO_RADIANS, lon: lon_2 / DEGREES_TO_RADIANS };
}

/** The centre every clustered geopoint is generated around (Zürich). */
export const GEO_CENTER: FixtureGeoPoint = { lat: 47.3769, lon: 8.5417 };

/** A document sitting exactly on the `GEO_BOUNDARY_RADIUS_M` circle. */
const GEO_BOUNDARY_POINT = destinationPoint(GEO_CENTER, 1000, 0);
/** A document just inside that circle. */
const GEO_INSIDE_POINT = destinationPoint(GEO_CENTER, 900, 90);
/** A document just outside that circle. */
const GEO_OUTSIDE_POINT = destinationPoint(GEO_CENTER, 1100, 180);
/** A document far outside every radius case. */
const GEO_FAR_POINT = destinationPoint(GEO_CENTER, 50_000, 270);

/**
 * The exact distance (metres) from `GEO_CENTER` to the boundary document.
 *
 * Battery radius cases use *this* value rather than a round `1000`, so the
 * boundary document is on the boundary by construction — `inside: true` must
 * include it (`<=`) and `inside: false` must exclude it (`>`), per the Orama
 * report §8.
 */
export const GEO_BOUNDARY_RADIUS_M = haversineMeters(GEO_CENTER, GEO_BOUNDARY_POINT);

/** Unit multipliers to metres, verified against Orama's `utils.js:246`. */
export const GEO_UNIT_METRES = {
	cm: 0.01,
	m: 1,
	km: 1000,
	ft: 0.3048,
	yd: 0.9144,
	mi: 1609.344,
} as const;

/**
 * The polygon used by every polygon battery case: an axis-aligned box with
 * corners (47, 8) and (48, 9). Vertices are exact decimals so the docs placed
 * on its edges/vertices are *exactly* on them (the PNPOLY predicate's half-open
 * boundary — bottom/left inside, top/right outside — is only observable when
 * the coordinates match bit-for-bit).
 */
export const POLYGON_BOX: FixtureGeoPoint[] = [
	{ lat: 47, lon: 8 },
	{ lat: 47, lon: 9 },
	{ lat: 48, lon: 9 },
	{ lat: 48, lon: 8 },
];

/**
 * A polygon that crosses the antimeridian. Planar ray casting spans the *long*
 * way around the globe (Orama report §9), so results here are "defined
 * behavior", never geographically meaningful — battery cases are tagged
 * `defined-behavior-only`.
 */
export const ANTIMERIDIAN_POLYGON: FixtureGeoPoint[] = [
	{ lat: -1, lon: 179 },
	{ lat: -1, lon: -179 },
	{ lat: 1, lon: -179 },
	{ lat: 1, lon: 179 },
];

/* -------------------------------------------------------------------------- */
/* Vectors                                                                    */
/* -------------------------------------------------------------------------- */

/** Test vectors are 8-dimensional — big enough to be a real dot product, small
 * enough to eyeball in a golden fixture. */
export const VECTOR_DIMENSIONS = 8;

/** The query vector every vector/hybrid battery case uses. */
export const VECTOR_QUERY: number[] = [1, 0, 0, 0, 0, 0, 0, 0];

/** A unit vector whose cosine similarity to `VECTOR_QUERY` is exactly `cosine`. */
function vectorWithCosine(cosine: number): number[] {
	const orthogonal = Math.sqrt(Math.max(0, 1 - cosine * cosine));
	return [cosine, orthogonal, 0, 0, 0, 0, 0, 0];
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Shared vocabulary — deliberately full of prefix families (`data`/`database`/
 * `dataset`/`datum`, `token`/`tokenizer`, `index`/`indexing`) and near-misses
 * (`hello`/`hallo`, `alpha`/`alpine`) so multi-token, prefix-expansion,
 * tolerance and `threshold` queries all produce interesting overlap.
 */
const VOCABULARY = [
	'alpha',
	'alpine',
	'beta',
	'gamma',
	'delta',
	'epsilon',
	'search',
	'engine',
	'data',
	'database',
	'dataset',
	'datum',
	'query',
	'index',
	'indexing',
	'token',
	'tokenizer',
	'postings',
	'record',
	'document',
	'hello',
	'hallo',
	'world',
	'cluster',
	'vector',
] as const;

const FIRST_NAMES = [
	'jane',
	'bob',
	'ada',
	'linus',
	'grace',
	'yuki',
	'anya',
	'omar',
] as const;
const LAST_NAMES = [
	'doe',
	'smith',
	'lovelace',
	'torvalds',
	'hopper',
	'tanaka',
	'ivanova',
] as const;
const EMAIL_DOMAINS = [
	'showandtour.com',
	'example.com',
	'delight.co',
	'mail.example.org',
] as const;

const CITIES = [
	'Zürich',
	'München',
	'Tokyo',
	'東京',
	'Москва',
	'New York',
	'San José',
	'São Paulo',
] as const;

const STATUS_VALUES = ['draft', 'published', 'archived'] as const;
const COUNTRY_VALUES = ['CH', 'US', 'JP', 'RU', 'BR'] as const;
/** Numeric enum values — `'5' !== 5` probes need a numeric enum to compare with. */
const TIER_VALUES = [1, 2, 3] as const;
const LABEL_IDS = ['l_red', 'l_green', 'l_blue', 'l_yellow'] as const;
const TAG_VALUES = ['red', 'green', 'blue', 'yellow', 'well-known'] as const;
const EVENT_KINDS = ['meetup', 'webinar', 'conference'] as const;
const REGION_VALUES = ['emea', 'amer', 'apac'] as const;

/** Ties matter: view counts are drawn from a tiny pool so equal values are
 * common and PK tie-breaks are exercised constantly (plan §4.6). */
const VIEW_COUNTS = [0, 1, 5, 5, 5, 10, 42, 100, -3] as const;
const RATINGS = [-2.5, -1, 0, 0.5, 1.25, 1.25, 3.75] as const;

/** Base timestamp for `updated_at`. Fixed, never `Date.now()`. */
export const BASE_UPDATED_AT = 1_700_000_000_000;
/** The single `updated_at` value shared by the tie-break edge documents. */
export const TIED_UPDATED_AT = BASE_UPDATED_AT + 500;

/** A 70-character token — over the 64-char cap (plan §4.1 step 5). */
const LONG_TOKEN = 'x'.repeat(70);
/** Shares the first 64 characters with `LONG_TOKEN`, so both truncate to the
 * *same* indexed token. */
const LONG_TOKEN_TWIN = `${'x'.repeat(64)}zzzzzz`;

function sentence(prng: Prng, word_count: number): string {
	const words: string[] = [];
	for (let index = 0; index < word_count; index++) {
		// Duplicates are allowed on purpose: term frequency has to matter.
		words.push(prng.pick(VOCABULARY));
	}
	return words.join(' ');
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

/** Wide preset, **string primary key**. */
export const ARTICLE_SCHEMA = {
	id: 'string',
	title: 'string',
	body: 'string',
	summary: 'string',
	author_name: 'string',
	author_email: 'string',
	slug: 'string',
	code: 'string',
	status: 'enum',
	tier: 'enum',
	tags: 'string[]',
	label_ids: 'enum[]',
	view_count: 'number',
	rating: 'number',
	scores: 'number[]',
	is_published: 'boolean',
	flags: 'boolean[]',
	address: {
		city: 'string',
		country: 'enum',
		postal_code: 'string',
	},
	location: 'geopoint',
	embedding: 'vector[8]',
	updated_at: 'number',
} as const satisfies FixtureSchema;

/** Narrow preset, **integer primary key** (plan §8.2 requirement). */
export const EVENT_SCHEMA = {
	id: 'number',
	name: 'string',
	notes: 'string',
	kind: 'enum',
	attendee_emails: 'string[]',
	seat_labels: 'string[]',
	capacity: 'number',
	price: 'number',
	is_virtual: 'boolean',
	venue: {
		city: 'string',
		region: 'enum',
	},
	place: 'geopoint',
	embedding: 'vector[8]',
	updated_at: 'number',
} as const satisfies FixtureSchema;

/* -------------------------------------------------------------------------- */
/* Corpus shape                                                               */
/* -------------------------------------------------------------------------- */

export type CorpusPresetName = 'article' | 'event';
export type CorpusSizeName = 'tiny' | 'small' | 'large';

/** The three sizes named by plan §8.1. */
export const CORPUS_SIZES: Record<CorpusSizeName, number> = {
	tiny: 10,
	small: 1000,
	large: 20000,
};

export interface Corpus {
	/** `'<preset>-<size>'`, e.g. `'article-small'`. */
	name: string;
	preset: CorpusPresetName;
	/** The numeric seed actually used (already hashed if a string was given). */
	seed: number;
	size: number;
	schema: FixtureSchema;
	primary_key: string;
	primary_key_type: 'string' | 'number';
	docs: FixtureDocument[];
}

export interface GenerateCorpusOptions {
	preset?: CorpusPresetName;
	size?: CorpusSizeName | number;
	seed?: number | string;
}

/* -------------------------------------------------------------------------- */
/* Article edge documents                                                     */
/* -------------------------------------------------------------------------- */

/** Every article field, filled with unremarkable values — edge docs override
 * only what they are probing. */
function articleBase(id: string): FixtureDocument {
	return {
		id,
		title: 'baseline record',
		body: 'baseline body with search engine words',
		summary: 'baseline summary',
		author_name: 'jane doe',
		author_email: 'jane.doe@showandtour.com',
		slug: 'baseline-record',
		code: '100',
		status: 'published',
		tier: 2,
		tags: ['red'],
		label_ids: ['l_red'],
		view_count: 5,
		rating: 1.25,
		scores: [1, 2, 3],
		is_published: true,
		flags: [true, false],
		address: { city: 'Zürich', country: 'CH', postal_code: '8001' },
		location: { ...GEO_CENTER },
		embedding: vectorWithCosine(0.5),
		updated_at: BASE_UPDATED_AT,
	};
}

/**
 * The hand-authored edge documents. They always come first in the corpus, so
 * the small/large presets contain all of them and the `tiny` (10-doc) smoke
 * preset contains the first ten. Ordering is therefore deliberate: the most
 * generally useful probes are listed first.
 */
function articleEdgeDocs(): FixtureDocument[] {
	const docs: FixtureDocument[] = [];
	const add = (id: string, overrides: FixtureDocument): void => {
		docs.push({ ...articleBase(id), ...overrides });
	};
	/** Removes a key entirely — "absent" is not the same as `null` (plan §5). */
	const addWithout = (
		id: string,
		omit_keys: string[],
		overrides: FixtureDocument,
	): void => {
		const doc = { ...articleBase(id), ...overrides };
		for (const key of omit_keys) delete doc[key];
		docs.push(doc);
	};

	/* --- string-PK ordering: '10' sorts before '2' ------------------------- */
	add('2', { title: 'pk two', view_count: 5, updated_at: TIED_UPDATED_AT });
	add('10', { title: 'pk ten', view_count: 5, updated_at: TIED_UPDATED_AT });

	/* --- unicode ----------------------------------------------------------- */
	add('edge_unicode_diacritic', {
		title: 'Zürich Café Résumé',
		body: 'naïve résumé from Zürich and München',
		address: { city: 'Zürich', country: 'CH', postal_code: '8001' },
	});
	add('edge_unicode_cjk', {
		title: '東京 データベース',
		body: '東京 tokyo database search',
		address: { city: '東京', country: 'JP', postal_code: '100' },
	});
	add('edge_unicode_cyrillic', {
		title: 'Москва поиск',
		body: 'Москва moscow index engine',
		address: { city: 'Москва', country: 'RU', postal_code: '101' },
	});
	add('edge_astral_high', {
		// U+1F600. Sorts AFTER U+FFFD by code point, BEFORE it by UTF-16 code
		// unit — the astral ordering probe (plan §4.6).
		title: '\u{1F600} grinning',
		code: '\u{1F600}',
	});
	add('edge_astral_replacement', { title: '\uFFFD replacement', code: '\uFFFD' });

	/* --- term frequency ----------------------------------------------------- */
	add('edge_repeated_words', {
		title: 'repetition',
		body: 'repeat repeat repeat repeat repeat',
	});
	add('edge_single_words', { title: 'once', body: 'repeat once only here alpha' });

	/* --- null vs absent ----------------------------------------------------- */
	add('edge_null_rating', { rating: null, tags: [], label_ids: [], scores: [] });
	addWithout('edge_absent_rating', ['rating', 'tags', 'label_ids', 'scores'], {});

	/* --- emails -------------------------------------------------------------- */
	add('edge_email_plain', {
		title: 'email holder',
		author_email: 'jane.doe@showandtour.com',
		body: 'no address in this body at all',
	});
	add('edge_email_prose', {
		title: 'prose email',
		body: 'please contact jane@example.com today about alpha',
		author_email: 'bob@example.com',
	});
	add('edge_email_other_domain', {
		title: 'other domain',
		author_email: 'ada@delight.co',
		body: 'ada lovelace writes about indexing',
	});

	/* --- punctuation / splitter deviations ----------------------------------- */
	add('edge_punctuation', {
		title: "it's a well-known co-op",
		body: 'snake_case_field and kebab-case-field and possessive jane’s',
		tags: ['well-known'],
	});

	/* --- token length cap ---------------------------------------------------- */
	add('edge_long_token', { title: 'long token', body: `${LONG_TOKEN} tail` });
	add('edge_long_token_twin', {
		title: 'long token twin',
		body: `${LONG_TOKEN_TWIN} tail`,
	});

	/* --- numeric strings ----------------------------------------------------- */
	add('edge_numeric_strings', {
		title: 'five 5 numbers',
		code: '5',
		view_count: 5,
		tier: 3,
		address: { city: 'New York', country: 'US', postal_code: '10' },
	});

	/* --- empty strings -------------------------------------------------------- */
	add('edge_empty_string', { title: '', body: '', summary: '', code: '' });

	/* --- equal sort keys ------------------------------------------------------ */
	add('edge_tie_a', {
		title: 'tie a',
		view_count: 5,
		rating: 1.25,
		updated_at: TIED_UPDATED_AT,
	});
	add('edge_tie_b', {
		title: 'tie b',
		view_count: 5,
		rating: 1.25,
		updated_at: TIED_UPDATED_AT,
	});
	add('edge_tie_c', {
		title: 'tie c',
		view_count: 5,
		rating: 1.25,
		updated_at: TIED_UPDATED_AT,
	});

	/* --- booleans -------------------------------------------------------------- */
	add('edge_bool_true', { is_published: true, flags: [true, true] });
	add('edge_bool_false', { is_published: false, flags: [false] });
	addWithout('edge_bool_absent', ['is_published', 'flags'], {});

	/* --- arrays ---------------------------------------------------------------- */
	add('edge_arrays_full', {
		tags: ['red', 'green', 'blue'],
		label_ids: ['l_red', 'l_green', 'l_blue'],
		scores: [-3, 0, 7],
	});
	add('edge_arrays_single', { tags: ['red'], label_ids: ['l_red'], scores: [5] });

	/* --- negatives / floats ----------------------------------------------------- */
	add('edge_negative_numbers', { view_count: -3, rating: -2.5, scores: [-3, -1, 0] });

	/* --- prefix / tolerance / threshold ------------------------------------------ */
	add('edge_prefix_family', { title: 'prefixes', body: 'data database dataset datum' });
	add('edge_tolerance_hello', { title: 'hello holder', body: 'hello world one two' });
	add('edge_tolerance_hallo', { title: 'hallo holder', body: 'hallo world one two' });
	add('edge_threshold_both_same_field', { title: 'alpha beta', summary: 'unrelated' });
	add('edge_threshold_split_fields', { title: 'alpha', summary: 'beta' });
	add('edge_threshold_alpha_only', { title: 'alpha', summary: 'unrelated' });
	add('edge_threshold_beta_only', { title: 'beta', summary: 'unrelated' });
	add('edge_threshold_prefix_quirk', { title: 'alp alpine', summary: 'unrelated' });
	add('edge_exact_case', { title: 'Cat sat on the mat', body: 'Cat' });
	add('edge_exact_case_lower', { title: 'cat ran away', body: 'cat' });

	/* --- geo: radius -------------------------------------------------------------- */
	add('edge_geo_center', { location: { ...GEO_CENTER } });
	add('edge_geo_boundary_exact', { location: GEO_BOUNDARY_POINT });
	add('edge_geo_inside_near', { location: GEO_INSIDE_POINT });
	add('edge_geo_outside_near', { location: GEO_OUTSIDE_POINT });
	add('edge_geo_far', { location: GEO_FAR_POINT });
	add('edge_geo_null', { location: null });
	addWithout('edge_geo_missing', ['location'], {});

	/* --- geo: polygon (half-open boundary, Orama report §9) ------------------------ */
	add('edge_poly_inside', { location: { lat: 47.5, lon: 8.5 } });
	add('edge_poly_bottom_edge', { location: { lat: 47, lon: 8.5 } });
	add('edge_poly_left_edge', { location: { lat: 47.5, lon: 8 } });
	add('edge_poly_top_edge', { location: { lat: 48, lon: 8.5 } });
	add('edge_poly_right_edge', { location: { lat: 47.5, lon: 9 } });
	add('edge_poly_vertex_bottom_left', { location: { lat: 47, lon: 8 } });
	add('edge_poly_vertex_top_right', { location: { lat: 48, lon: 9 } });
	add('edge_poly_outside', { location: { lat: 46, lon: 7 } });

	/* --- geo: antimeridian ---------------------------------------------------------- */
	add('edge_anti_east', { location: { lat: 0, lon: 179 } });
	add('edge_anti_west', { location: { lat: 0, lon: -179 } });
	add('edge_anti_zero', { location: { lat: 0, lon: 0 } });

	/* --- vectors (cosines against VECTOR_QUERY; never the zero vector) ------------- */
	add('edge_vec_cos_100', { embedding: vectorWithCosine(1) });
	add('edge_vec_cos_095', { embedding: vectorWithCosine(0.95) });
	add('edge_vec_cos_085', { embedding: vectorWithCosine(0.85) });
	add('edge_vec_cos_080', { embedding: vectorWithCosine(0.8) });
	add('edge_vec_cos_079', { embedding: vectorWithCosine(0.79) });
	add('edge_vec_cos_050', { embedding: vectorWithCosine(0.5) });
	add('edge_vec_cos_000', { embedding: [0, 1, 0, 0, 0, 0, 0, 0] });
	add('edge_vec_non_unit', { embedding: [3, 0, 0, 0, 0, 0, 0, 0] });
	addWithout('edge_vec_missing', ['embedding'], {});
	add('edge_vec_hybrid_text', {
		title: 'alpha hybrid anchor',
		body: 'alpha alpha search',
		embedding: vectorWithCosine(0.9),
	});

	/* --- distinct_on groups ---------------------------------------------------------- */
	add('edge_distinct_a1', {
		status: 'draft',
		view_count: 7,
		title: 'distinct alpha one',
	});
	add('edge_distinct_a2', {
		status: 'draft',
		view_count: 7,
		title: 'distinct alpha two',
	});
	add('edge_distinct_b1', {
		status: 'archived',
		view_count: 7,
		title: 'distinct beta one',
	});

	/* --- tokenizer rules frozen 2026-08-12 (plan §4.1 steps 6–11) ------------- */
	// APPENDED deliberately: the `tiny` preset takes the FIRST ten edge
	// documents, so nothing above may be reordered. Every probe below uses a
	// nonce vocabulary (`widget`, `microscope`, `usa`, `johns`) that no other
	// battery term touches, so these documents cannot perturb the parity tier.
	add('edge_camel_case', {
		title: 'getWidgetInfo helper',
		body: 'the getWidgetInfo call wraps HTTPServer and XMLHttpRequest',
	});
	add('edge_format_characters', {
		// A soft hyphen (U+00AD) inside `microscope` and a zero-width joiner
		// (U+200D) inside `telescope`: both fold to nothing, so each word is one
		// token here and two in Orama.
		title: 'micro­scope holder',
		body: 'tele‍scope and micro­scope stay whole words',
	});
	add('edge_acronym_dots', {
		title: 'U.S.A. filings',
		body: 'e.g. the U.S. Army files quarterly',
	});
	add('edge_decimal_numbers', {
		title: 'release 2.5.1',
		body: 'ratio 3.14 over 1,000 units, desk 555-1234',
		code: '7',
	});
	add('edge_modifier_apostrophe', {
		// U+02BC MODIFIER LETTER APOSTROPHE — a `\p{L}`, so it would glue the
		// possessive into `johnʼs` without the demotion rule.
		title: 'johnʼs ledger',
		body: 'the ledger of johnʼs quarterly filings',
	});

	return docs;
}

function generateArticleDoc(prng: Prng, index: number): FixtureDocument {
	const id = `art_${String(index).padStart(6, '0')}`;
	const first_name = prng.pick(FIRST_NAMES);
	const last_name = prng.pick(LAST_NAMES);
	const domain = prng.pick(EMAIL_DOMAINS);
	const email = `${first_name}.${last_name}@${domain}`;
	const has_null_rating = prng.bool(0.06);
	const has_absent_rating = prng.bool(0.06);
	const doc: FixtureDocument = {
		id,
		title: sentence(prng, prng.int(2, 5)),
		body: prng.bool(0.15)
			? `${sentence(prng, prng.int(6, 14))} contact ${email} today`
			: sentence(prng, prng.int(6, 14)),
		summary: sentence(prng, prng.int(3, 6)),
		author_name: `${first_name} ${last_name}`,
		author_email: email,
		slug: `${first_name}-${last_name}-${index}`,
		code: String(prng.int(1, 20)),
		status: prng.pick(STATUS_VALUES),
		tier: prng.pick(TIER_VALUES),
		tags: prng.bool(0.1) ? [] : prng.sample(TAG_VALUES, prng.int(1, 3)),
		label_ids: prng.bool(0.1) ? [] : prng.sample(LABEL_IDS, prng.int(1, 3)),
		view_count: prng.pick(VIEW_COUNTS),
		rating: prng.pick(RATINGS),
		scores: prng.bool(0.1) ? [] : [prng.int(-5, 5), prng.int(-5, 5)],
		is_published: prng.bool(0.6),
		flags: [prng.bool(), prng.bool()],
		address: {
			city: prng.pick(CITIES),
			country: prng.pick(COUNTRY_VALUES),
			postal_code: String(prng.int(1, 9999)),
		},
		location: destinationPoint(GEO_CENTER, prng.float(0, 40_000), prng.float(0, 360)),
		// Every 7th vector is deliberately non-unit so the write-time
		// normalization step (plan §4.9) is exercised. Never the zero vector.
		embedding:
			index % 7 === 0
				? prng.unitVector(VECTOR_DIMENSIONS).map((component) => component * 3)
				: prng.unitVector(VECTOR_DIMENSIONS),
		// Coarse quantization guarantees plenty of equal `updated_at` values.
		updated_at: BASE_UPDATED_AT + prng.int(0, 50) * 1000,
	};
	if (has_null_rating) doc.rating = null;
	if (has_absent_rating) delete doc.rating;
	if (prng.bool(0.05)) delete doc.location;
	if (prng.bool(0.03)) doc.location = null;
	return doc;
}

/* -------------------------------------------------------------------------- */
/* Event documents (integer primary key)                                      */
/* -------------------------------------------------------------------------- */

function eventBase(id: number): FixtureDocument {
	return {
		id,
		name: 'baseline event',
		notes: 'baseline notes about search and indexing',
		kind: 'meetup',
		attendee_emails: ['jane.doe@showandtour.com'],
		seat_labels: ['a1'],
		capacity: 50,
		price: 0,
		is_virtual: false,
		venue: { city: 'Zürich', region: 'emea' },
		place: { ...GEO_CENTER },
		embedding: vectorWithCosine(0.5),
		updated_at: BASE_UPDATED_AT,
	};
}

/**
 * Integer-PK edge documents occupy ids 1..N so that `2` and `10` are always
 * present with identical sort keys — the `2 < 10` (not `'10' < '2'`) tie-break
 * probe required by plan §8.2.
 */
function eventEdgeDocs(): FixtureDocument[] {
	const docs: FixtureDocument[] = [];
	const add = (id: number, overrides: FixtureDocument): void => {
		docs.push({ ...eventBase(id), ...overrides });
	};
	const addWithout = (
		id: number,
		omit_keys: string[],
		overrides: FixtureDocument,
	): void => {
		const doc = { ...eventBase(id), ...overrides };
		for (const key of omit_keys) delete doc[key];
		docs.push(doc);
	};

	add(1, { name: 'alpha beta kickoff', capacity: 10, updated_at: TIED_UPDATED_AT });
	// ids 2 and 10 share every sort key — only the PK tie-break separates them.
	add(2, { name: 'tie two', capacity: 10, updated_at: TIED_UPDATED_AT });
	add(3, { name: 'gamma delta workshop', capacity: 25, price: -5.5 });
	add(4, { name: '東京 データ meetup', venue: { city: '東京', region: 'apac' } });
	add(5, { name: 'Zürich café社 meetup', venue: { city: 'Zürich', region: 'emea' } });
	add(6, { name: '\u{1F600} astral event', notes: 'emoji title' });
	add(7, { name: '\uFFFD replacement event', notes: 'replacement char title' });
	add(8, { name: 'null price', price: null, seat_labels: [], attendee_emails: [] });
	addWithout(9, ['price', 'seat_labels', 'place'], { name: 'absent fields' });
	add(10, { name: 'tie ten', capacity: 10, updated_at: TIED_UPDATED_AT });
	add(11, { name: 'boundary geo', place: GEO_BOUNDARY_POINT });
	add(12, { name: 'polygon vertex', place: { lat: 47, lon: 8 } });
	add(13, { name: 'repeat repeat repeat', notes: 'repeat repeat repeat repeat' });
	add(14, {
		name: 'prose email event',
		notes: 'ping ada@delight.co about the alpha session',
	});
	add(15, { name: '', notes: '', seat_labels: [] });
	add(16, { name: 'vector anchor', embedding: vectorWithCosine(1) });
	add(17, { name: 'vector boundary', embedding: vectorWithCosine(0.8) });
	add(18, { name: 'vector below', embedding: vectorWithCosine(0.79) });
	add(19, { name: 'virtual one', is_virtual: true, kind: 'webinar' });
	add(20, { name: 'virtual two', is_virtual: true, kind: 'webinar' });

	return docs;
}

function generateEventDoc(prng: Prng, index: number): FixtureDocument {
	const first_name = prng.pick(FIRST_NAMES);
	const last_name = prng.pick(LAST_NAMES);
	const doc: FixtureDocument = {
		id: index,
		name: sentence(prng, prng.int(2, 5)),
		notes: sentence(prng, prng.int(5, 12)),
		kind: prng.pick(EVENT_KINDS),
		attendee_emails: prng.bool(0.1)
			? []
			: [`${first_name}.${last_name}@${prng.pick(EMAIL_DOMAINS)}`],
		seat_labels: prng.bool(0.1)
			? []
			: prng.sample(['a1', 'a2', 'b1', 'b2'], prng.int(1, 3)),
		capacity: prng.pick([10, 10, 25, 50, 100, -1]),
		price: prng.pick([0, 0, 9.99, 19.5, -5.5]),
		is_virtual: prng.bool(0.4),
		venue: { city: prng.pick(CITIES), region: prng.pick(REGION_VALUES) },
		place: destinationPoint(GEO_CENTER, prng.float(0, 40_000), prng.float(0, 360)),
		embedding: prng.unitVector(VECTOR_DIMENSIONS),
		updated_at: BASE_UPDATED_AT + prng.int(0, 50) * 1000,
	};
	if (prng.bool(0.06)) doc.price = null;
	if (prng.bool(0.06)) delete doc.price;
	if (prng.bool(0.05)) delete doc.place;
	return doc;
}

/* -------------------------------------------------------------------------- */
/* Public generator                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Generates a deterministic corpus.
 *
 * The same `{ preset, size, seed }` always produces a deeply-equal result, on
 * every machine and every engine.
 */
export function generateCorpus(options: GenerateCorpusOptions = {}): Corpus {
	const preset = options.preset ?? 'article';
	const size_name = options.size ?? 'small';
	const size = typeof size_name === 'number' ? size_name : CORPUS_SIZES[size_name];
	const seed_input =
		options.seed ?? `${preset}-${typeof size_name === 'number' ? size : size_name}`;
	const prng = createPrng(seed_input);

	const edge_docs = preset === 'article' ? articleEdgeDocs() : eventEdgeDocs();
	const docs = edge_docs.slice(0, size);
	for (let index = docs.length; index < size; index++) {
		docs.push(
			preset === 'article'
				? generateArticleDoc(prng, index)
				: generateEventDoc(prng, index + 1),
		);
	}

	return {
		name: `${preset}-${typeof size_name === 'number' ? size : size_name}`,
		preset,
		seed: prng.seed,
		size: docs.length,
		schema: preset === 'article' ? ARTICLE_SCHEMA : EVENT_SCHEMA,
		primary_key: 'id',
		primary_key_type: preset === 'article' ? 'string' : 'number',
		docs,
	};
}

/** The schema for a preset, without generating any documents. */
export function schemaForPreset(preset: CorpusPresetName): FixtureSchema {
	return preset === 'article' ? ARTICLE_SCHEMA : EVENT_SCHEMA;
}

/**
 * Error-case fixture: documents carrying zero vectors.
 *
 * Deliberately kept **out** of every standard corpus — plan §4.9 rejects
 * zero-norm vectors at write time with `DelightError.badRequest`, so these
 * exist only to assert that rejection.
 */
export const ZERO_VECTOR_DOCS: FixtureDocument[] = [
	{ ...articleBase('err_zero_vector'), embedding: [0, 0, 0, 0, 0, 0, 0, 0] },
	{
		...articleBase('err_zero_vector_negative_zero'),
		embedding: [-0, 0, 0, 0, 0, 0, 0, -0],
	},
];

/**
 * Error-case fixture: a document whose vector has the wrong dimensionality for
 * the declared `vector[8]` field.
 */
export const WRONG_DIMENSION_VECTOR_DOCS: FixtureDocument[] = [
	{ ...articleBase('err_short_vector'), embedding: [1, 0, 0] },
	{
		...articleBase('err_long_vector'),
		embedding: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	},
];
