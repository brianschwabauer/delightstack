import { describe, expect, it } from 'vitest';
import { diffStructured } from './diff.structured';
import { diffLines, diffWords, type DiffOp } from './diff.text';

/** Deterministic PRNG (mulberry32) — no Math.random anywhere in this suite. */
function makeRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const VOCABULARY = [
	'harbour',
	'morning',
	'boats',
	'pier',
	'boardwalk',
	'coffee',
	'diesel',
	'argued',
	'room',
	'light',
	'salt',
	'window',
	'letter',
	'engine',
	'rope',
	'gull',
	'tide',
	'lantern',
	'ledger',
	'crate',
	'quiet',
	'slow',
	'grey',
	'warm',
	'narrow',
];

/** A pseudo-document of `word_count` words, broken into sentences and paragraphs. */
function makeDocument(random: () => number, word_count: number): string[] {
	const words: string[] = [];
	for (let i = 0; i < word_count; i++) {
		words.push(VOCABULARY[Math.floor(random() * VOCABULARY.length)]);
		if (i % 14 === 13) words.push('.');
		if (i % 120 === 119) words.push('\n\n');
	}
	return words;
}

/** Apply `edit_count` scattered single-word edits. */
function scatterEdits(
	random: () => number,
	words: string[],
	edit_count: number,
): string[] {
	const edited = words.slice();
	for (let i = 0; i < edit_count; i++) {
		const index = Math.floor(random() * edited.length);
		const roll = random();
		if (roll < 0.34) edited.splice(index, 1);
		else if (roll < 0.67)
			edited.splice(index, 0, VOCABULARY[Math.floor(random() * VOCABULARY.length)]);
		else edited[index] = VOCABULARY[Math.floor(random() * VOCABULARY.length)];
	}
	return edited;
}

function expectRoundTrip(ops: DiffOp[], old_text: string, new_text: string): void {
	expect(
		ops
			.filter((op) => op.type !== 'insert')
			.map((op) => op.text)
			.join(''),
	).toBe(old_text);
	expect(
		ops
			.filter((op) => op.type !== 'delete')
			.map((op) => op.text)
			.join(''),
	).toBe(new_text);
}

/**
 * Absolute wall-clock budgets, asserted only off CI.
 *
 * These numbers describe the algorithm on a development machine (measured
 * 2026-08: diffWords 50k words ~58ms, diffLines ~9ms, diffStructured 20k
 * blocks ~26ms). A shared CI runner is routinely 5-8x slower — the same suite
 * measured 408ms / 121ms / 334ms on GitHub Actions — so asserting the budget
 * there tests the runner's hardware, not this package.
 *
 * Raising the number until CI is green would be worse than useless: it would
 * stop catching a real 4x regression while still flaking on a busy runner. The
 * regression these tests exist to catch is algorithmic (someone making Myers
 * quadratic), and `expectSubQuadratic` below catches that on any hardware,
 * because a ratio cancels out machine speed.
 *
 * Set `DIFF_BENCH=1` to assert the budgets anywhere.
 */
function expectWithinBudget(elapsed_ms: number, budget_ms: number): void {
	if (process.env.CI && !process.env.DIFF_BENCH) return;
	expect(elapsed_ms).toBeLessThan(budget_ms);
}

/**
 * Assert that doubling the input does not roughly quadruple the time.
 *
 * Uses the **fastest** of several rounds at each size rather than the median:
 * scheduler noise only ever adds time, so the minimum is the least-biased
 * estimate of the true cost and the most stable thing to take a ratio of.
 *
 * Linear-ish work lands near 2.0; quadratic lands at 4.0 or above. The bound
 * sits at 3.0 — comfortably above the honest result and comfortably below a
 * genuine regression.
 */
function expectSubQuadratic(measure: (size: number) => number, base_size: number): void {
	const fastest = (size: number): number => {
		const rounds = [measure(size), measure(size), measure(size)];
		return Math.min(...rounds);
	};
	const small_ms = fastest(base_size);
	const large_ms = fastest(base_size * 2);
	const ratio = large_ms / Math.max(small_ms, 0.001);
	console.log(
		`scaling ${base_size} -> ${base_size * 2}: ` +
			`${small_ms.toFixed(1)}ms -> ${large_ms.toFixed(1)}ms (${ratio.toFixed(2)}x)`,
	);
	expect(ratio).toBeLessThan(3);
}

describe('performance', () => {
	it('diffs two 50,000-word documents in under 100ms', () => {
		const random = makeRandom(0xa11ce);
		const words = makeDocument(random, 50_000);
		const old_text = words.join(' ');
		const new_text = scatterEdits(random, words, 100).join(' ');

		// Warm the JIT on a smaller pair first: the numbers below should measure the
		// algorithm, not V8's first-call compilation of it.
		const warm_words = makeDocument(makeRandom(0xfeed), 5_000);
		diffWords(warm_words.join(' '), scatterEdits(random, warm_words, 20).join(' '));

		const timings: number[] = [];
		let ops: DiffOp[] = [];
		for (let round = 0; round < 3; round++) {
			const started_at = performance.now();
			ops = diffWords(old_text, new_text);
			timings.push(performance.now() - started_at);
		}

		expectRoundTrip(ops, old_text, new_text);
		const median_ms = timings.slice().sort((a, b) => a - b)[1];
		console.log(
			`diffWords 50k words: ${timings.map((ms) => `${ms.toFixed(1)}ms`).join(' / ')} ` +
				`(median ${median_ms.toFixed(1)}ms), ${ops.length} ops`,
		);
		expectWithinBudget(median_ms, 100);
		// A hundred scattered edits should not produce thousands of ops.
		expect(ops.length).toBeLessThan(800);
	});

	it('line-diffs a 50,000-word document in under 100ms', () => {
		const random = makeRandom(0x11e5);
		const words = makeDocument(random, 50_000);
		const lines: string[] = [];
		for (let i = 0; i < words.length; i += 12)
			lines.push(`${words.slice(i, i + 12).join(' ')}\n`);
		const old_text = lines.join('');

		const edited = lines.slice();
		for (let i = 0; i < 100; i++) {
			edited[Math.floor(random() * edited.length)] =
				`${VOCABULARY[i % VOCABULARY.length]} edited\n`;
		}
		const new_text = edited.join('');

		diffLines(old_text.slice(0, 2000), new_text.slice(0, 2000));

		const started_at = performance.now();
		const ops = diffLines(old_text, new_text);
		const elapsed_ms = performance.now() - started_at;

		expectRoundTrip(ops, old_text, new_text);
		console.log(`diffLines 50k words: ${elapsed_ms.toFixed(1)}ms, ${ops.length} ops`);
		expectWithinBudget(elapsed_ms, 100);
	});

	it('structurally diffs 20,000 blocks in under 100ms', () => {
		const random = makeRandom(0xb10c);
		const old_blocks = Array.from({ length: 20_000 }, (_unused, index) => ({
			id: `block-${index}`,
		}));

		// Shuffle 200 blocks to the front, drop 100, and add 100 new ones.
		const new_blocks = old_blocks.slice();
		for (let i = 0; i < 200; i++) {
			const from = Math.floor(random() * new_blocks.length);
			const [block] = new_blocks.splice(from, 1);
			new_blocks.unshift(block);
		}
		for (let i = 0; i < 100; i++)
			new_blocks.splice(Math.floor(random() * new_blocks.length), 1);
		for (let i = 0; i < 100; i++) {
			new_blocks.splice(Math.floor(random() * new_blocks.length), 0, {
				id: `added-${i}`,
			});
		}

		const key = (block: { id: string }): string => block.id;
		diffStructured(old_blocks.slice(0, 100), new_blocks.slice(0, 100), key);

		const started_at = performance.now();
		const result = diffStructured(old_blocks, new_blocks, key);
		const elapsed_ms = performance.now() - started_at;

		console.log(
			`diffStructured 20k blocks: ${elapsed_ms.toFixed(1)}ms, ` +
				`${result.counts.moved} moved, ${result.counts.inserted} inserted, ` +
				`${result.counts.deleted} deleted`,
		);
		expectWithinBudget(elapsed_ms, 100);
		expect(result.counts.inserted).toBe(100);
		expect(result.counts.deleted).toBeGreaterThan(0);
		expect(result.counts.moved).toBeGreaterThan(0);
	});

	// The regression these budgets were really guarding against. Unlike a
	// millisecond count, a ratio is portable: it holds on a laptop and on a
	// throttled CI runner, so this one is asserted everywhere.
	it('diffWords stays sub-quadratic as the document doubles', () => {
		const random = makeRandom(0x5ca1e);
		expectSubQuadratic((size) => {
			const words = makeDocument(random, size);
			const old_text = words.join(' ');
			const new_text = scatterEdits(random, words, 100).join(' ');
			const started_at = performance.now();
			diffWords(old_text, new_text);
			return performance.now() - started_at;
		}, 20_000);
	});

	it('diffStructured stays sub-quadratic as the block count doubles', () => {
		const random = makeRandom(0x5ca2e);
		expectSubQuadratic((size) => {
			const old_blocks = Array.from({ length: size }, (_unused, index) => ({
				id: `block-${index}`,
			}));
			const new_blocks = old_blocks.slice();
			for (let i = 0; i < 200; i++) {
				const from = Math.floor(random() * new_blocks.length);
				const [block] = new_blocks.splice(from, 1);
				new_blocks.unshift(block);
			}
			const key = (block: { id: string }): string => block.id;
			const started_at = performance.now();
			diffStructured(old_blocks, new_blocks, key);
			return performance.now() - started_at;
		}, 10_000);
	});
});
