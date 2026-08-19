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
		expect(median_ms).toBeLessThan(100);
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
		expect(elapsed_ms).toBeLessThan(100);
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
		expect(elapsed_ms).toBeLessThan(100);
		expect(result.counts.inserted).toBe(100);
		expect(result.counts.deleted).toBeGreaterThan(0);
		expect(result.counts.moved).toBeGreaterThan(0);
	});
});
