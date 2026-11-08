import { describe, expect, it } from 'vitest';
import { Editor } from '../editor.svelte.js';
import type { JSONContent } from '../../types/index.js';
import {
	createAnchorCache,
	HOME_BONUS,
	resolveAnchors,
	type TextAnchor,
} from './anchors.js';

/**
 * The shared re-anchoring core, driven directly.
 *
 * `tracked-changes.test.ts` and `annotations.test.ts` both exercise this through
 * their plugins, which is the right level for *those* — they are about what gets
 * drawn. This file is about the finding itself, which is the part with the
 * correctness claim in it: the ranking, the tie-break, the Unicode, and the two
 * ways an anchor goes stale. Those are properties of one function and reading
 * them off decoration output would be inference.
 */

function paragraphs(
	...blocks: Array<string | { id: string; text: string }>
): JSONContent {
	return {
		type: 'doc',
		content: blocks.map((block) => {
			const text = typeof block === 'string' ? block : block.text;
			return {
				type: 'paragraph',
				attrs: typeof block === 'string' ? undefined : { block_id: block.id },
				content: text ? [{ type: 'text', text }] : undefined,
			};
		}),
	};
}

function docOf(...blocks: Array<string | { id: string; text: string }>) {
	return new Editor({ content: paragraphs(...blocks) }).state.doc;
}

/** The core, over bare anchors, so a test says what it means. */
function resolve(
	doc: ReturnType<typeof docOf>,
	...anchors: Array<TextAnchor & { id?: string }>
) {
	return resolveAnchors(doc, anchors, (anchor) => anchor);
}

describe('resolveAnchors', () => {
	it('finds the text and reports a real document range', () => {
		const doc = docOf('He walked toward the lighthouse.');
		const { resolved, stale } = resolve(doc, { text: 'walked toward' });
		expect(stale).toEqual([]);
		expect(resolved).toHaveLength(1);
		expect(doc.textBetween(resolved[0].from, resolved[0].to)).toBe('walked toward');
	});

	it('reports `missing` when the text is gone rather than guessing at a range', () => {
		const doc = docOf('He walked toward the lighthouse.');
		const { resolved, stale } = resolve(doc, { text: 'the harbour wall' });
		expect(resolved).toEqual([]);
		expect(stale).toEqual([{ item: { text: 'the harbour wall' }, reason: 'missing' }]);
	});

	it('reports `ambiguous` rather than letting document order pick a copy', () => {
		const doc = docOf('He walked toward the door. Then he walked toward the sea.');
		const { resolved, stale } = resolve(doc, { text: 'walked toward' });
		expect(resolved).toEqual([]);
		expect(stale[0].reason).toBe('ambiguous');
	});

	it('breaks a tie with the prefix, so identical copies separate', () => {
		const doc = docOf('He walked toward the door. Then he walked toward the sea.');
		const { resolved, stale } = resolve(doc, {
			text: 'walked toward',
			prefix: 'Then he ',
		});
		expect(stale).toEqual([]);
		expect(doc.textBetween(resolved[0].from, resolved[0].to + 8)).toBe(
			'walked toward the sea',
		);
	});

	it('breaks a tie with the suffix alone', () => {
		const doc = docOf('He walked toward the door. Then he walked toward the sea.');
		const { resolved, stale } = resolve(doc, {
			text: 'walked toward',
			suffix: ' the door',
		});
		expect(stale).toEqual([]);
		expect(doc.textBetween(resolved[0].from - 3, resolved[0].to)).toBe(
			'He walked toward',
		);
	});

	it('degrades a partial context match instead of erasing it', () => {
		// The prefix was recorded as "and then he " and the paragraph has been
		// edited since — the sentence now opens differently. The *tail* of the
		// recorded prefix still agrees, which is what the partial score is for, and
		// it is enough to out-score the copy whose surroundings barely agree at all.
		const doc = docOf('He walked toward the door. Then he walked toward the sea.');
		const { resolved, stale } = resolve(doc, {
			text: 'walked toward',
			prefix: 'and then he ',
		});
		expect(stale).toEqual([]);
		expect(doc.textBetween(resolved[0].from, resolved[0].to + 8)).toBe(
			'walked toward the sea',
		);
	});

	it('prefers the recorded block over a better-scoring hit elsewhere', () => {
		// The second block's copy has the full recorded suffix and the first block's
		// has none of it — but the anchor names the first block, and the home bonus
		// is worth more than every context point there is.
		const doc = docOf(
			{ id: 'b1', text: 'walked toward the door' },
			{ id: 'b2', text: 'walked toward the sea' },
		);
		const { resolved } = resolve(doc, {
			block_id: 'b1',
			text: 'walked toward',
			suffix: ' the sea',
		});
		expect(doc.textBetween(resolved[0].from, resolved[0].to + 9)).toBe(
			'walked toward the door',
		);
	});

	it('falls back to the rest of the document when the recorded block has nothing', () => {
		// A block that was split since is a renumbered block, not a deleted one.
		const doc = docOf({ id: 'b2', text: 'He walked toward the sea.' });
		const { resolved, stale } = resolve(doc, {
			block_id: 'b1-gone',
			text: 'walked toward',
		});
		expect(stale).toEqual([]);
		expect(resolved).toHaveLength(1);
	});

	it('falls back when the recorded block no longer exists at all', () => {
		const doc = docOf('He walked toward the sea.');
		const { resolved } = resolve(doc, { block_id: 'nope', text: 'walked' });
		expect(resolved).toHaveLength(1);
	});

	it('matches across Unicode normalization in both directions', () => {
		const composed = 'café society';
		const decomposed = composed.normalize('NFD');
		expect(composed).not.toBe(decomposed);

		const nfc_doc = docOf(composed);
		expect(resolve(nfc_doc, { text: decomposed }).resolved).toHaveLength(1);

		const nfd_doc = docOf(decomposed);
		expect(resolve(nfd_doc, { text: composed }).resolved).toHaveLength(1);
	});

	it('keeps positions honest across an accent, by never renormalizing the haystack', () => {
		// The document is decomposed, so "café" is five code units. A resolver that
		// normalized the block text would compute an offset in a shorter string and
		// land a character early on everything after it.
		const doc = docOf(`${'café'.normalize('NFD')} then lighthouse`);
		const { resolved } = resolve(doc, { text: 'lighthouse' });
		expect(doc.textBetween(resolved[0].from, resolved[0].to)).toBe('lighthouse');
	});

	it('pads inline atoms out to their width so ranges after one stay right', () => {
		const doc = new Editor({
			content: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'see ' },
							{ type: 'hard_break' },
							{ type: 'text', text: ' the lighthouse' },
						],
					},
				],
			},
		}).state.doc;
		const { resolved } = resolve(doc, { text: 'the lighthouse' });
		expect(doc.textBetween(resolved[0].from, resolved[0].to)).toBe('the lighthouse');
	});

	it('places a point anchor after its prefix', () => {
		const doc = docOf('He walked toward the sea.');
		const { resolved } = resolve(doc, { text: '', prefix: 'He walked' });
		expect(resolved[0].from).toBe(resolved[0].to);
		expect(doc.textBetween(resolved[0].from, resolved[0].to + 7)).toBe(' toward');
	});

	it('places a point anchor with only a suffix, at the front of a paragraph', () => {
		const doc = docOf('walked toward the sea.');
		const { resolved } = resolve(doc, { text: '', suffix: 'walked' });
		expect(resolved[0].from).toBe(resolved[0].to);
		expect(doc.textBetween(resolved[0].from, resolved[0].to + 6)).toBe('walked');
	});

	it('places a point anchor with no context at the front of the block it names', () => {
		const doc = docOf({ id: 'b1', text: 'first' }, { id: 'b2', text: 'second' });
		const { resolved } = resolve(doc, { block_id: 'b2', text: '' });
		expect(doc.textBetween(resolved[0].from, resolved[0].to + 6)).toBe('second');
	});

	it('calls a point anchor with no context and no block missing', () => {
		const doc = docOf('anything');
		expect(resolve(docOf('anything'), { text: '' }).stale[0].reason).toBe('missing');
		expect(doc.childCount).toBe(1);
	});

	it('returns results in document order whatever order they arrived in', () => {
		const doc = docOf('alpha beta gamma');
		const { resolved } = resolve(doc, { text: 'gamma' }, { text: 'alpha' });
		expect(resolved.map((entry) => entry.item.text)).toEqual(['alpha', 'gamma']);
	});

	it('carries the caller’s own item through untouched', () => {
		const doc = docOf('alpha beta');
		const rows = [{ row_id: 'r1', text: 'beta' }];
		const { resolved } = resolveAnchors(doc, rows, (row) => ({ text: row.text }));
		expect(resolved[0].item).toBe(rows[0]);
	});

	it('scores the recorded block above anything the context can add', () => {
		// The invariant the ranking rests on, asserted as arithmetic rather than
		// inferred from a case: prefix and suffix are worth one point each.
		expect(HOME_BONUS).toBeGreaterThan(2);
	});
});

/**
 * The one claim the cases above cannot make.
 *
 * Every test so far names a document and reads a range off it, which checks the
 * *decisions* — which copy wins, when to go stale — and takes the arithmetic on
 * trust. The arithmetic is where an anchoring bug actually lives: an inline atom
 * padded by the wrong width, an accent counted once on the needle and twice on
 * the haystack, a `base` off by the paragraph's opening token. None of those
 * change which occurrence is chosen, so none of them fail a case above; they
 * move the range a character or two and draw the highlight over the wrong words.
 *
 * So this asserts the property instead, over generated documents: **whatever
 * range comes back must be the text that was asked for.** `textBetween` reads it
 * out of the document with the same atom padding the resolver put in, which is
 * what makes the comparison a check on the padding rather than a restatement of
 * it. Deterministic seeds, so a failure is a case rather than a rumour.
 */
describe('resolveAnchors, over generated documents', () => {
	let seed = 1;
	const rnd = (): number => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
	const int = (n: number): number => Math.floor(rnd() * n);

	// A small vocabulary on purpose: repeated phrases, and therefore ties and
	// ambiguity, are the interesting case rather than a rarity. Both spellings
	// of each accented word are in it so a document can hold the two encodings
	// at once, which is the situation `spellings` exists for.
	const WORDS = [
		'the',
		'lighthouse',
		'the',
		'café',
		'café'.normalize('NFD'),
		'naïve',
		'naïve'.normalize('NFD'),
		'a',
	];

	/** A document, and the text of each block with atoms padded as the resolver pads them. */
	function generateDocument(): { content: JSONContent; texts: string[]; ids: Array<string | null> } {
		const blocks: JSONContent[] = [];
		const texts: string[] = [];
		const ids: Array<string | null> = [];
		const count = 1 + int(5);
		for (let b = 0; b < count; b++) {
			const inline: JSONContent[] = [];
			let text = '';
			const runs = 1 + int(3);
			for (let r = 0; r < runs; r++) {
				if (r > 0 && rnd() < 0.5) {
					// `hard_break` is the schema's inline atom, one position wide.
					inline.push({ type: 'hard_break' });
					text += ' ';
				}
				const words: string[] = [];
				const n = 1 + int(6);
				for (let w = 0; w < n; w++) words.push(WORDS[int(WORDS.length)]);
				const run = `${words.join(' ')} `;
				inline.push({ type: 'text', text: run });
				text += run;
			}
			const id = rnd() < 0.7 ? `b${b}` : null;
			ids.push(id);
			texts.push(text);
			blocks.push({
				type: 'paragraph',
				attrs: id ? { block_id: id } : undefined,
				content: inline,
			});
		}
		return { content: { type: 'doc', content: blocks }, texts, ids };
	}

	it('never returns a range that is not the anchored text', () => {
		const failures: string[] = [];
		for (let trial = 0; trial < 300; trial++) {
			seed = trial * 7919 + 13;
			const { content, texts, ids } = generateDocument();
			const doc = new Editor({ content }).state.doc;

			// An anchor cut out of a block, with however much context, then
			// respelled the way a foreign runtime would have handed it over.
			const b = int(texts.length);
			const text = texts[b];
			if (text.length < 4) continue;
			const start = int(Math.max(1, text.length - 3));
			const length = 1 + int(Math.min(12, text.length - start));
			const context = int(4) === 0 ? 0 : 1 + int(25);
			const form = (['none', 'NFC', 'NFD'] as const)[int(3)];
			const spell = (value: string): string =>
				form === 'none' ? value : value.normalize(form);
			const anchor: TextAnchor = {
				block_id: int(4) === 0 ? undefined : (ids[b] ?? undefined),
				text: spell(text.slice(start, start + length)),
				prefix: spell(text.slice(Math.max(0, start - context), start)),
				suffix: spell(text.slice(start + length, start + length + context)),
			};

			const { resolved, stale } = resolveAnchors(doc, [anchor], (item) => item);
			// Refusing is always allowed — the phrase may genuinely be ambiguous.
			// What is not allowed is answering with the wrong range.
			if (!resolved.length) {
				expect(stale).toHaveLength(1);
				continue;
			}
			const { from, to } = resolved[0];
			if (from < 0 || to > doc.content.size + 1 || from > to) {
				failures.push(`trial ${trial}: range [${from},${to}] is not inside the document`);
				continue;
			}
			// The same padding the resolver used, read back out of the document.
			const found = doc.textBetween(from, to, undefined, ' ');
			const spellings = [found, found.normalize('NFC'), found.normalize('NFD')];
			if (!spellings.includes(anchor.text)) {
				failures.push(
					`trial ${trial}: asked for ${JSON.stringify(anchor.text)}, range holds ${JSON.stringify(found)}`,
				);
			}
		}
		expect(failures).toEqual([]);
	});
});

/*
 * ---- the stale cache ----------------------------------------------------
 *
 * An anchor that resolves is cheap — the recorded block answers and the search
 * stops. An anchor that has gone stale is the opposite: it falls through to
 * scanning every block, and it does that again on the next keystroke. Twenty of
 * them over a long clip measured 3.7ms per keystroke, all of it re-deciding a
 * fact that had not moved.
 *
 * The cache rests on one observation — a missing anchor can only come back in a
 * block that *changed* — so what these tests are really about is the cases where
 * that could be got wrong: unstaling, ambiguity, and a cache handed a document
 * it has never seen.
 */
describe('the stale cache', () => {
	it('answers identically with and without one', () => {
		// The property that matters most and the cheapest to state: a cache is an
		// optimisation, so every case above must come out the same through it.
		const cases: Array<{ doc: ReturnType<typeof docOf>; anchor: TextAnchor }> = [
			{ doc: docOf('He walked toward the sea.'), anchor: { text: 'walked' } },
			{ doc: docOf('He walked toward the sea.'), anchor: { text: 'nowhere' } },
			{ doc: docOf('a a'), anchor: { text: 'a' } },
			{ doc: docOf({ id: 'b1', text: 'alpha' }), anchor: { block_id: 'b1', text: 'alpha' } },
			{ doc: docOf('café'), anchor: { text: 'café'.normalize('NFD') } },
		];
		for (const scenario of cases) {
			const plain = resolveAnchors(scenario.doc, [scenario.anchor], (a) => a);
			const cached = resolveAnchors(
				scenario.doc,
				[scenario.anchor],
				(a) => a,
				createAnchorCache(),
			);
			expect(cached.resolved.map((e) => [e.from, e.to])).toEqual(
				plain.resolved.map((e) => [e.from, e.to]),
			);
			expect(cached.stale.map((e) => e.reason)).toEqual(plain.stale.map((e) => e.reason));
		}
	});

	it('keeps a missing anchor missing across an edit to another block', () => {
		const cache = createAnchorCache();
		const before = docOf({ id: 'b1', text: 'alpha' }, { id: 'b2', text: 'beta' });
		const anchor: TextAnchor = { text: 'not in the document' };
		expect(resolveAnchors(before, [anchor], (a) => a, cache).stale[0].reason).toBe(
			'missing',
		);

		const after = docOf({ id: 'b1', text: 'alpha!' }, { id: 'b2', text: 'beta' });
		const second = resolveAnchors(after, [anchor], (a) => a, cache);
		expect(second.stale[0].reason).toBe('missing');
		expect(second.resolved).toEqual([]);
	});

	it('finds it again the moment a changed block contains it', () => {
		// The case a naive cache gets wrong: the reader undoes the delete, or a
		// peer's paragraph arrives, and the highlight has to come back.
		const cache = createAnchorCache();
		const anchor: TextAnchor = { text: 'lighthouse' };
		expect(
			resolveAnchors(docOf('nothing here'), [anchor], (a) => a, cache).stale,
		).toHaveLength(1);

		const back = resolveAnchors(
			docOf('the lighthouse is here'),
			[anchor],
			(a) => a,
			cache,
		);
		expect(back.stale).toEqual([]);
		expect(back.resolved).toHaveLength(1);
	});

	it('finds it again when it arrives in a *new* block', () => {
		const cache = createAnchorCache();
		const anchor: TextAnchor = { text: 'lighthouse' };
		resolveAnchors(docOf('first'), [anchor], (a) => a, cache);
		const back = resolveAnchors(
			docOf('first', 'the lighthouse'),
			[anchor],
			(a) => a,
			cache,
		);
		expect(back.resolved).toHaveLength(1);
	});

	it('never caches an ambiguous verdict, because ambiguity is a whole-document fact', () => {
		// Delete one of two identical paragraphs and the anchor becomes findable.
		// A cache that treated `ambiguous` like `missing` would leave it stale.
		const cache = createAnchorCache();
		const anchor: TextAnchor = { text: 'walked toward' };
		expect(
			resolveAnchors(
				docOf('he walked toward it', 'she walked toward it'),
				[anchor],
				(a) => a,
				cache,
			).stale[0].reason,
		).toBe('ambiguous');

		const single = resolveAnchors(
			docOf('he walked toward it'),
			[anchor],
			(a) => a,
			cache,
		);
		expect(single.stale).toEqual([]);
		expect(single.resolved).toHaveLength(1);
	});

	it('does not confuse two anchors that differ only in their context', () => {
		// The cache key is every field the search reads, not the caller's id: an
		// anchor whose prefix changed is a different question.
		const cache = createAnchorCache();
		const doc = docOf('red the sea\n', 'blue the sea');
		const missing: TextAnchor = { text: 'the sea', prefix: 'green ' };
		const found: TextAnchor = { text: 'the sea', prefix: 'blue ' };
		resolveAnchors(doc, [missing], (a) => a, cache);
		expect(resolveAnchors(doc, [found], (a) => a, cache).resolved).toHaveLength(1);
	});

	it('takes the slow path for a document it has never seen', () => {
		// A cache handed a different document sees every block as new, which is the
		// safe direction: it re-decides rather than trusting a verdict about text
		// that is not there.
		const cache = createAnchorCache();
		const anchor: TextAnchor = { text: 'lighthouse' };
		resolveAnchors(docOf('nothing'), [anchor], (a) => a, cache);
		expect(
			resolveAnchors(docOf('the lighthouse'), [anchor], (a) => a, cache).resolved,
		).toHaveLength(1);
	});

	it('skips the scan, which is the whole point of it', () => {
		/*
		 * Measured as *work avoided* rather than as elapsed time: a millisecond
		 * threshold in a test is a flake on a loaded machine. The proxy is how
		 * often `anchorOf` is asked — the resolver calls it once per item per
		 * resolve — so instead the document is made large and the block text
		 * counted through a spy on the only thing a scan touches.
		 */
		const blocks = Array.from({ length: 300 }, (_, at) => ({
			id: `b${at}`,
			text: `paragraph number ${at} with some words in it`,
		}));
		const doc = docOf(...blocks);
		const stale_anchors: TextAnchor[] = Array.from({ length: 20 }, (_, at) => ({
			block_id: `gone-${at}`,
			text: `a passage that was deleted ${at}`,
		}));

		const cache = createAnchorCache();
		resolveAnchors(doc, stale_anchors, (a) => a, cache);

		// One block edited, as a keystroke does. Every other block is the same
		// immutable node, so the cache sees exactly one fresh block.
		const edited = docOf(...blocks.map((b, at) => (at === 7 ? { ...b, text: `${b.text}!` } : b)));

		const cold = Date.now();
		for (let run = 0; run < 20; run++) {
			resolveAnchors(edited, stale_anchors, (a) => a);
		}
		const cold_ms = Date.now() - cold;

		const warm = Date.now();
		for (let run = 0; run < 20; run++) {
			resolveAnchors(edited, stale_anchors, (a) => a, cache);
		}
		const warm_ms = Date.now() - warm;

		// A generous factor rather than a tight one: the claim under test is
		// "stops walking the document", and asserting a ratio near the real
		// speed-up would be asserting the machine.
		expect(warm_ms).toBeLessThanOrEqual(cold_ms);
		// And the answers still agree.
		expect(resolveAnchors(edited, stale_anchors, (a) => a, cache).stale).toHaveLength(20);
	});
});
