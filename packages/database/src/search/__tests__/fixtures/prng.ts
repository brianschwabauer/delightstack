/**
 * Seeded, deterministic pseudo-random number generation for the search test
 * fixtures.
 *
 * Nothing in the search test infrastructure may call `Math.random()` or
 * `Date.now()` — corpora have to be byte-reproducible so that the differential
 * harness (plan §8.1) and the golden-vector suite (plan §8.2) compare the same
 * documents on every machine, in every engine, forever.
 *
 * The generator is splitmix32: 32-bit state, ~10 lines, no dependencies, and
 * identical output under every JS engine because it only uses `|0`, `>>>`,
 * `^` and `Math.imul` (all exactly specified integer operations — unlike the
 * transcendentals called out in plan §3).
 */

/** A deterministic random source. */
export interface Prng {
	/** The seed this generator was created from. */
	readonly seed: number;
	/** Next float in `[0, 1)`. */
	next(): number;
	/** Next integer in `[min, max]` (both inclusive). */
	int(min: number, max: number): number;
	/** Next float in `[min, max)`. */
	float(min: number, max: number): number;
	/** `true` with the given probability (default `0.5`). */
	bool(probability?: number): boolean;
	/** Uniformly picks one item. Throws on an empty list. */
	pick<T>(items: readonly T[]): T;
	/** A new shuffled copy (Fisher–Yates, seeded). */
	shuffle<T>(items: readonly T[]): T[];
	/** `count` distinct items, in shuffled order. Clamped to `items.length`. */
	sample<T>(items: readonly T[], count: number): T[];
	/** A unit-length vector of `dimensions` components (never the zero vector). */
	unitVector(dimensions: number): number[];
}

/** The splitmix32 core: seed in, `() => float in [0, 1)` out. */
export function splitmix32(seed: number): () => number {
	let state = seed | 0;
	return () => {
		state = (state + 0x9e3779b9) | 0;
		let value = state ^ (state >>> 16);
		value = Math.imul(value, 0x21f0aaad);
		value = value ^ (value >>> 15);
		value = Math.imul(value, 0x735a2d97);
		value = value ^ (value >>> 15);
		return (value >>> 0) / 4294967296;
	};
}

/**
 * Turns a string into a 32-bit seed (FNV-1a). Lets fixtures be seeded with a
 * readable name (`'article-small'`) instead of a magic number.
 */
export function hashSeed(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash | 0;
}

/** Creates a seeded generator. The same seed always yields the same stream. */
export function createPrng(seed: number | string): Prng {
	const numeric_seed = typeof seed === 'string' ? hashSeed(seed) : seed | 0;
	const next = splitmix32(numeric_seed);

	const prng: Prng = {
		seed: numeric_seed,
		next,
		int(min, max) {
			if (max < min) throw new Error(`prng.int: max (${max}) < min (${min})`);
			return min + Math.floor(next() * (max - min + 1));
		},
		float(min, max) {
			return min + next() * (max - min);
		},
		bool(probability = 0.5) {
			return next() < probability;
		},
		pick(items) {
			if (items.length === 0) throw new Error('prng.pick: empty list');
			return items[Math.floor(next() * items.length)] as (typeof items)[number];
		},
		shuffle(items) {
			const copy = items.slice();
			for (let index = copy.length - 1; index > 0; index--) {
				const swap_index = Math.floor(next() * (index + 1));
				const held = copy[index] as (typeof copy)[number];
				copy[index] = copy[swap_index] as (typeof copy)[number];
				copy[swap_index] = held;
			}
			return copy;
		},
		sample(items, count) {
			return prng.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length)));
		},
		unitVector(dimensions) {
			const components: number[] = [];
			let sum_of_squares = 0;
			for (let index = 0; index < dimensions; index++) {
				// Box–Muller would need Math.log/Math.cos; a plain uniform in
				// [-1, 1] is fine for fixture vectors and stays deterministic.
				const component = prng.float(-1, 1);
				components.push(component);
				sum_of_squares += component * component;
			}
			// Guarantee a non-zero norm: the standard corpora must never contain a
			// zero vector (plan §4.9 rejects those at write time; the rejection is
			// covered by a dedicated error fixture instead).
			if (sum_of_squares < 1e-6) {
				components[0] = 1;
				sum_of_squares = 1;
			}
			const norm = Math.sqrt(sum_of_squares);
			return components.map((component) => component / norm);
		},
	};

	return prng;
}
