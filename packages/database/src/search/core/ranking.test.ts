/**
 * Query planning, ranking and highlighting (core/expansion, core/proximity),
 * through the memory reference engine. The server and client drivers are held
 * to the same answers by the golden vectors.
 */

import { describe, expect, it } from 'vitest';
import { MemorySearchEngine } from '../memory/engine.js';
import { quantizeLength } from './bm25.js';
import {
	autoTolerance,
	MAX_PREFIX_EXPANSIONS,
	MAX_SHORT_PREFIX_EXPANSIONS,
	planQueryTerms,
	pluralVariants,
	PREFIX_POSTING_BUDGET,
	selectExpansions,
} from './expansion.js';
import { highlightValue } from './proximity.js';
import { DEFAULT_MAX_FIELD_TOKENS, tokenizeField } from './tokenizer.js';
import type { WhereSchema } from './where.js';

const SCHEMA: WhereSchema = { title: 'string', body: 'string' };

function engine(docs: Record<string, unknown>[], field_options = {}) {
	const search = new MemorySearchEngine({ schema: SCHEMA, field_options });
	search.insertMany(docs);
	return search;
}

const ids = (result: { hits: { id: string }[] }) => result.hits.map((hit) => hit.id);

describe('match weights', () => {
	it('ranks exact above a plural, a prefix and a typo', () => {
		const search = engine([
			{ id: 'typo', title: 'kontract' },
			{ id: 'prefix', title: 'contractor' },
			{ id: 'plural', title: 'contracts' },
			{ id: 'exact', title: 'contract' },
		]);
		expect(ids(search.search({ term: 'contract' }))).toEqual([
			'exact',
			'plural',
			'prefix',
			'typo',
		]);
	});

	it('turns typos, plurals and prefixes off with exact', () => {
		const search = engine([
			{ id: 'exact', title: 'contract' },
			{ id: 'plural', title: 'contracts' },
			{ id: 'typo', title: 'contarct' },
		]);
		expect(ids(search.search({ term: 'contract', exact: true }))).toEqual(['exact']);
	});
});

describe('default typo tolerance', () => {
	it('scales with word length and never fuzzes digits', () => {
		expect(autoTolerance('elm')).toBe(0);
		expect(autoTolerance('hello')).toBe(1);
		expect(autoTolerance('apartment')).toBe(2);
		expect(autoTolerance('67202')).toBe(0);
		expect(autoTolerance('unit4b')).toBe(0);
	});

	it('finds a misspelling without asking for tolerance, and tolerance 0 turns it off', () => {
		const search = engine([{ id: 'a', title: 'Residential contract' }]);
		expect(ids(search.search({ term: 'residental' }))).toEqual(['a']);
		expect(ids(search.search({ term: 'residental', tolerance: 0 }))).toEqual([]);
	});

	it('does not match a zip code one digit away', () => {
		const search = engine([{ id: 'a', title: '67203' }]);
		expect(ids(search.search({ term: '67202' }))).toEqual([]);
	});
});

describe('plural variants', () => {
	it('maps common English plurals both ways', () => {
		expect(pluralVariants('contracts')).toContain('contract');
		expect(pluralVariants('contract')).toContain('contracts');
		expect(pluralVariants('properties')).toContain('property');
		expect(pluralVariants('property')).toContain('properties');
		expect(pluralVariants('boxes')).toContain('box');
		expect(pluralVariants('class')).not.toContain('clas');
		expect(pluralVariants('a1')).toEqual([]);
	});

	it('lets a plural query find the singular', () => {
		const search = engine([{ id: 'a', title: 'one property' }]);
		expect(ids(search.search({ term: 'properties' }))).toEqual(['a']);
	});
});

describe('expansion caps', () => {
	it('keeps the most frequent prefix completions, capped by count and by postings', () => {
		const [term] = planQueryTerms(['ca'], {});
		const raw = Array.from(
			{ length: 40 },
			(_, index) => `ca${String(index).padStart(2, '0')}`,
		);
		const selected = selectExpansions(term, raw, 0, (token) => Number(token.slice(2)));
		expect(selected.length).toBeLessThanOrEqual(MAX_SHORT_PREFIX_EXPANSIONS);
		// Most frequent first: ca39, ca38, …
		expect(selected.map((entry) => entry.token)).toContain('ca39');
		expect(selected.map((entry) => entry.token)).not.toContain('ca00');

		const [long] = planQueryTerms(['cab'], {});
		const many = Array.from({ length: 200 }, (_, index) => `cab${index}`);
		expect(selectExpansions(long, many, 0, () => 1).length).toBe(MAX_PREFIX_EXPANSIONS);
		const heavy = selectExpansions(long, many, 0, () => PREFIX_POSTING_BUDGET / 2);
		expect(heavy.length).toBe(2);
		// A single completion over the whole budget is still taken.
		expect(selectExpansions(long, many, 0, () => PREFIX_POSTING_BUDGET * 3).length).toBe(
			1,
		);
	});
});

describe('field weights', () => {
	it('lets a heavier field outrank the same words elsewhere, and a query boost override it', () => {
		const docs = [
			{ id: 'in_body', body: 'oak street' },
			{ id: 'in_title', title: 'oak street' },
		];
		const weighted = engine(docs, { body: { weight: 3 } });
		expect(ids(weighted.search({ term: 'oak' }))[0]).toBe('in_body');
		expect(ids(weighted.search({ term: 'oak', boost: { body: 0.1 } }))[0]).toBe(
			'in_title',
		);
	});
});

describe('proximity', () => {
	it('ranks the words side by side, in order, above the same words apart', () => {
		const search = engine([
			{ id: 'apart', title: 'street on the main road' },
			{ id: 'together', title: 'the road at main street' },
		]);
		expect(ids(search.search({ term: 'main street' }))).toEqual(['together', 'apart']);
	});
});

describe('highlights', () => {
	it('marks the matched words, prefix and typo matches included', () => {
		const search = engine([{ id: 'a', title: 'Residential sale contract', body: 'x' }]);
		const [hit] = search.search({ term: 'residental contr', highlight: true }).hits;
		const title = hit.highlights?.title;
		expect(title?.text).toBe('Residential sale contract');
		expect(title?.ranges.map(([start, end]) => title.text.slice(start, end))).toEqual([
			'Residential',
			'contract',
		]);
		expect(hit.highlights?.body).toBeUndefined();
	});

	it('cuts a long value to a snippet around the first match', () => {
		const text = `${'lorem ipsum '.repeat(40)}the deadline is Friday ${'dolor sit '.repeat(40)}`;
		const highlight = highlightValue(text, new Set(['deadline']), 80);
		expect(highlight?.text.startsWith('…')).toBe(true);
		expect(highlight?.text.endsWith('…')).toBe(true);
		const [[start, end]] = highlight!.ranges;
		expect(highlight!.text.slice(start, end)).toBe('deadline');
	});

	it('is absent unless asked for', () => {
		const search = engine([{ id: 'a', title: 'contract' }]);
		expect(search.search({ term: 'contract' }).hits[0].highlights).toBeUndefined();
	});
});

describe('field token cap', () => {
	it('indexes the first max_tokens distinct words of a value', () => {
		const words = Array.from({ length: 1500 }, (_, index) => `w${index}`).join(' ');
		expect(new Set(tokenizeField(words)).size).toBe(DEFAULT_MAX_FIELD_TOKENS);
		expect(new Set(tokenizeField(words, 10)).size).toBe(10);
		expect(new Set(tokenizeField(words, Infinity)).size).toBe(1500);
		const search = engine([{ id: 'a', body: words }], { body: { max_tokens: 10 } });
		expect(ids(search.search({ term: 'w5', exact: true }))).toEqual(['a']);
		expect(ids(search.search({ term: 'w500', exact: true }))).toEqual([]);
	});
});

describe('length rounding', () => {
	it('is exact below 32, then about 6% steps, and idempotent', () => {
		for (let length = 0; length < 32; length++)
			expect(quantizeLength(length)).toBe(length);
		expect(quantizeLength(1000)).toBe(992);
		expect(quantizeLength(1001)).toBe(992);
		expect(quantizeLength(2000)).toBe(1984);
		for (const length of [33, 100, 999, 12345]) {
			expect(quantizeLength(quantizeLength(length))).toBe(quantizeLength(length));
			expect(length - quantizeLength(length)).toBeLessThan(length * 0.07);
		}
	});
});
