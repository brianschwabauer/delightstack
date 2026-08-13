import { describe, expect, it } from 'vitest';
import { cosineSimilarity, embed, EMBEDDING_DIMENSIONS } from './embedding';
import { CITIES, DEFAULT_SEED, generateCorpus } from './seed';

describe('search lab embedding', () => {
	it('produces a unit-length vector of the declared width', () => {
		const vector = embed('Northwind Coffee — a slow-pour espresso bar');
		expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
		const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
		expect(norm).toBeCloseTo(1, 3);
	});

	it('is deterministic', () => {
		expect(embed('Café Zoë Roasters')).toEqual(embed('Café Zoë Roasters'));
	});

	it('folds diacritics and camelCase the same way at write and query time', () => {
		expect(embed('Café DataOps')).toEqual(embed('cafe data ops'));
	});

	it('scores related concepts above unrelated ones', () => {
		const coffee = embed('espresso bar with a barista pulling single-origin shots');
		const bakery = embed('sourdough bakery selling bread and pastry each morning');
		const gym = embed('bouldering gym with a weekly problem reset and yoga studio');
		expect(cosineSimilarity(coffee, bakery)).toBeGreaterThan(
			cosineSimilarity(coffee, gym),
		);
	});

	it('returns a zero vector for text with no usable tokens', () => {
		expect(embed('!!! ???')).toEqual(
			Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
		);
	});
});

describe('search lab corpus', () => {
	it('is deterministic for a given seed', () => {
		expect(generateCorpus(DEFAULT_SEED, 40)).toEqual(generateCorpus(DEFAULT_SEED, 40));
	});

	it('changes with the seed', () => {
		const a = generateCorpus(DEFAULT_SEED, 40);
		const b = generateCorpus(DEFAULT_SEED + 1, 40);
		expect(a.places.map((place) => place.name)).not.toEqual(
			b.places.map((place) => place.name),
		);
	});

	it('generates a prefix of the same corpus when asked for fewer places', () => {
		const small = generateCorpus(DEFAULT_SEED, 10);
		const large = generateCorpus(DEFAULT_SEED, 40);
		expect(small.places).toEqual(large.places.slice(0, 10));
	});

	it('spreads places across every city cluster', () => {
		const corpus = generateCorpus(DEFAULT_SEED, 120);
		const cities = new Set(corpus.places.map((place) => place.address.city));
		expect(cities.size).toBe(CITIES.length);
	});

	it('leaves some ratings and prices null so nulls-last sorting is visible', () => {
		const corpus = generateCorpus(DEFAULT_SEED, 324);
		expect(corpus.places.some((place) => place.rating === null)).toBe(true);
		expect(corpus.places.some((place) => place.price === null)).toBe(true);
	});

	it('embeds every place with a full-width vector', () => {
		const corpus = generateCorpus(DEFAULT_SEED, 24);
		for (const place of corpus.places) {
			expect(place.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
		}
	});

	it('points every place at a real organization index', () => {
		const corpus = generateCorpus(DEFAULT_SEED, 200);
		for (const place of corpus.places) {
			expect(place.organization_index).toBeGreaterThanOrEqual(0);
			expect(place.organization_index).toBeLessThan(corpus.organizations.length);
		}
	});
});
