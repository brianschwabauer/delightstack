/**
 * A tiny, deterministic, zero-dependency "embedding" for the Search Lab.
 *
 * There is no embedding service here — callers supply vectors, so the lab needs
 * one function that is cheap, offline, and *identical* at write time and query
 * time. It produces a unit-length 64-dimension vector from two signals:
 *
 * 1. **Concepts** (dims 0–11). A small hand-written lexicon maps words onto 12
 *    concepts. Hitting a concept adds a large weight to its dimension and a
 *    smaller weight to related concepts, so "espresso bar" lands near "coffee
 *    roaster" without either sharing a token.
 * 2. **Surface form** (dims 12–63). Token and character-trigram hashes, so
 *    literal overlap (and near-misses like `bakery`/`bakerys`) still counts.
 *
 * The two blocks are normalized independently and then blended, which keeps the
 * concept signal dominant no matter how long the text is — a one-word query and
 * a 40-word description still land in the same neighbourhood. Cosine similarity
 * between two same-concept documents sits around 0.8, which is exactly where
 * the engine's default `similarity` threshold lives.
 */

/** Dimension count of every vector this module produces. */
export const EMBEDDING_DIMENSIONS = 64;

/** Dimensions 0..CONCEPT_DIMENSIONS-1 carry the concept signal. */
const CONCEPT_DIMENSIONS = 12;

/** Dimensions CONCEPT_DIMENSIONS.. carry hashed tokens and trigrams. */
const HASH_DIMENSIONS = EMBEDDING_DIMENSIONS - CONCEPT_DIMENSIONS;

/** Relative weight of the concept block once both blocks are unit-length. */
const CONCEPT_WEIGHT = 0.85;

/** Relative weight of the surface-form block. */
const SURFACE_WEIGHT = 0.5;

/** Weight a concept hit contributes to its own dimension. */
const CONCEPT_HIT = 3;

/** Weight a concept hit contributes to each related concept's dimension. */
const CONCEPT_NEIGHBOUR_HIT = 1;

/** Weight a character trigram contributes, relative to a whole token. */
const TRIGRAM_WEIGHT = 0.35;

/**
 * The concept lexicon. Order is load-bearing — a concept's index *is* its
 * dimension — so never reorder this list without reseeding the data.
 */
const CONCEPTS: { key: string; words: string[]; related: string[] }[] = [
	{
		key: 'coffee',
		words: [
			'coffee',
			'cafe',
			'espresso',
			'latte',
			'roaster',
			'barista',
			'brew',
			'mocha',
			'cappuccino',
		],
		related: ['bakery', 'workspace'],
	},
	{
		key: 'dining',
		words: [
			'restaurant',
			'dining',
			'kitchen',
			'bistro',
			'chef',
			'menu',
			'cuisine',
			'ramen',
			'taco',
			'food',
			'eat',
			'meal',
			'dinner',
			'lunch',
		],
		related: ['drinks', 'market'],
	},
	{
		key: 'bakery',
		words: [
			'bakery',
			'bread',
			'pastry',
			'croissant',
			'baker',
			'sourdough',
			'patisserie',
			'cake',
			'dessert',
		],
		related: ['coffee'],
	},
	{
		key: 'drinks',
		words: [
			'bar',
			'cocktail',
			'wine',
			'beer',
			'taproom',
			'pub',
			'brewery',
			'cider',
			'drinks',
			'nightlife',
		],
		related: ['dining', 'music'],
	},
	{
		key: 'books',
		words: [
			'bookstore',
			'books',
			'library',
			'reading',
			'literature',
			'novel',
			'zine',
			'read',
			'bookshop',
		],
		related: ['museum'],
	},
	{
		key: 'fitness',
		words: [
			'gym',
			'fitness',
			'yoga',
			'climbing',
			'workout',
			'pilates',
			'bouldering',
			'exercise',
			'training',
		],
		related: ['outdoors'],
	},
	{
		key: 'outdoors',
		words: [
			'park',
			'trail',
			'garden',
			'hiking',
			'riverside',
			'outdoor',
			'forest',
			'walk',
			'nature',
			'picnic',
		],
		related: ['fitness'],
	},
	{
		key: 'museum',
		words: [
			'museum',
			'exhibit',
			'sculpture',
			'curator',
			'archive',
			'artefact',
			'art',
			'gallery',
			'history',
		],
		related: ['books'],
	},
	{
		key: 'music',
		words: [
			'music',
			'concert',
			'vinyl',
			'records',
			'stage',
			'band',
			'amplifier',
			'live',
			'gig',
		],
		related: ['drinks'],
	},
	{
		key: 'workspace',
		words: [
			'coworking',
			'workspace',
			'desk',
			'office',
			'meeting',
			'dataops',
			'startup',
			'work',
			'wifi',
			'laptop',
		],
		related: ['coffee'],
	},
	{
		key: 'lodging',
		words: [
			'hotel',
			'hostel',
			'inn',
			'rooms',
			'lodge',
			'suite',
			'guesthouse',
			'stay',
			'sleep',
			'accommodation',
		],
		related: ['dining'],
	},
	{
		key: 'market',
		words: [
			'market',
			'grocer',
			'shop',
			'store',
			'retail',
			'boutique',
			'produce',
			'groceries',
			'shopping',
		],
		related: ['dining'],
	},
];

/** word → concept dimension, built once. */
const WORD_TO_CONCEPT = new Map<string, number>();

/** concept dimension → related concept dimensions, built once. */
const CONCEPT_NEIGHBOURS: number[][] = [];

for (const [index, concept] of CONCEPTS.entries()) {
	for (const word of concept.words) WORD_TO_CONCEPT.set(word, index);
}
for (const concept of CONCEPTS) {
	CONCEPT_NEIGHBOURS.push(
		concept.related
			.map((key) => CONCEPTS.findIndex((other) => other.key === key))
			.filter((index) => index >= 0),
	);
}

/** FNV-1a, 32-bit. Stable across engines because every step is `Math.imul`. */
function hash32(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Fold text down to bare lowercase ASCII-ish words: split camelCase joins,
 * strip diacritics, then break on anything that is not a letter or digit.
 * `Café DataOps` → `['cafe', 'data', 'ops']`.
 */
export function tokenizeForEmbedding(text: string): string[] {
	return text
		.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
		.normalize('NFD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 1);
}

/** L2-normalize in place. A zero vector is left alone. */
function normalize(vector: number[], from: number, to: number, scale: number): void {
	let sum = 0;
	for (let index = from; index < to; index++) sum += vector[index] * vector[index];
	if (sum === 0) return;
	const factor = scale / Math.sqrt(sum);
	for (let index = from; index < to; index++) vector[index] *= factor;
}

/**
 * Embed a string into a unit-length {@link EMBEDDING_DIMENSIONS}-dimension
 * vector. Pure and deterministic — the same input always gives the same output,
 * on the server at write time and in the query endpoint at read time.
 */
export function embed(text: string): number[] {
	const vector: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
	const tokens = tokenizeForEmbedding(text);

	for (const token of tokens) {
		const concept = WORD_TO_CONCEPT.get(token);
		if (concept !== undefined) {
			vector[concept] += CONCEPT_HIT;
			for (const neighbour of CONCEPT_NEIGHBOURS[concept]) {
				vector[neighbour] += CONCEPT_NEIGHBOUR_HIT;
			}
		}

		vector[CONCEPT_DIMENSIONS + (hash32(token) % HASH_DIMENSIONS)] += 1;

		const padded = `^${token}$`;
		for (let index = 0; index + 3 <= padded.length; index++) {
			const trigram = padded.slice(index, index + 3);
			vector[CONCEPT_DIMENSIONS + (hash32(trigram) % HASH_DIMENSIONS)] += TRIGRAM_WEIGHT;
		}
	}

	// Normalize each block on its own, blend, then normalize the whole so the
	// result is unit-length and cosine similarity is just a dot product.
	normalize(vector, 0, CONCEPT_DIMENSIONS, CONCEPT_WEIGHT);
	normalize(vector, CONCEPT_DIMENSIONS, EMBEDDING_DIMENSIONS, SURFACE_WEIGHT);
	normalize(vector, 0, EMBEDDING_DIMENSIONS, 1);

	// Round so the value that round-trips through JSON is the value we scored.
	return vector.map((component) => Math.round(component * 1e6) / 1e6);
}

/** Cosine similarity of two vectors. Both are unit-length, so this is a dot. */
export function cosineSimilarity(a: number[], b: number[]): number {
	let sum = 0;
	for (let index = 0; index < Math.min(a.length, b.length); index++) {
		sum += a[index] * b[index];
	}
	return sum;
}
